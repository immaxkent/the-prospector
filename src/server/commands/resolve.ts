/**
 * Clearing things out of the buffer, in batches, because that is how the review asks.
 *
 * Nothing leaves the pending buffer on its own: a prospect that never answered stays where
 * it is until a person says otherwise. That is deliberate — a system that quietly tidies
 * its own backlog has numbers nobody can trust — but it only works if saying otherwise is
 * cheap. Twenty separate confirmations is not cheap, and an operator who finds it tedious
 * stops doing it, at which point the buffer fills and prospecting stops for good.
 *
 * So: one decision, many prospects, each judged on its own. One bad id does not lose the
 * rest, and the refusals come back named.
 */
import { and, eq, inArray } from "drizzle-orm";
import type { Database } from "../db/client";
import { prospects } from "../db/schema";
import { assertTransition, type PipelineStage } from "../domain/pipeline";
import { invalid } from "./errors";
import { recordEvent } from "./events";

export const RESOLUTIONS = ["dequeue", "reject", "won", "lost"] as const;
export type Resolution = (typeof RESOLUTIONS)[number];

/**
 * What each decision means to the pipeline.
 *
 * `dequeue` is `nurture`: not a rejection, and not a judgement about the company — it is
 * "this went nowhere for now". Keeping that distinct from `reject` matters, because reject
 * carries a reason and feeds what the agent learns, and "they never replied" teaches it
 * nothing.
 */
const STAGE_FOR: Record<Resolution, PipelineStage> = {
  dequeue: "nurture",
  reject: "lost",
  won: "won",
  lost: "lost",
};

export interface ResolveResult {
  resolved: string[];
  refused: { id: string; reason: string }[];
}

export async function resolveProspects(
  db: Database,
  input: { endeavourId: string; prospectIds: readonly string[]; resolution: Resolution; reason?: string | null },
  now = new Date(),
): Promise<ResolveResult> {
  const ids = [...new Set(input.prospectIds)].filter((id) => id.trim());
  if (ids.length === 0) throw invalid("choose at least one prospect");
  if (!RESOLUTIONS.includes(input.resolution)) throw invalid("that is not something a prospect can be resolved as");

  const reason = input.reason?.trim() || null;
  // A rejection without a reason is the one that teaches the agent nothing and cannot be
  // reviewed later. The others are self-explanatory from the decision itself.
  if (input.resolution === "reject" && !reason) throw invalid("say why these are being rejected");

  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(prospects)
      .where(and(eq(prospects.endeavourId, input.endeavourId), inArray(prospects.id, ids)));
    const found = new Map(rows.map((r) => [r.id, r]));
    const result: ResolveResult = { resolved: [], refused: [] };
    const target = STAGE_FOR[input.resolution];

    for (const id of ids) {
      const row = found.get(id);
      if (!row) {
        result.refused.push({ id, reason: "not a prospect of this endeavour" });
        continue;
      }
      if (row.stage === target && (input.resolution !== "reject" || row.reviewStatus === "rejected")) {
        // Already there is not a failure: the operator gets the state they asked for.
        result.resolved.push(id);
        continue;
      }
      try {
        // The operator is doing this, so the user rules apply: they are allowed to say a
        // deal is won without it having passed through every stage first.
        assertTransition(row.stage, target, "user");
      } catch (err) {
        result.refused.push({ id, reason: err instanceof Error ? err.message : "cannot be moved there" });
        continue;
      }

      await tx
        .update(prospects)
        .set({
          stage: target,
          ...(input.resolution === "reject" ? { reviewStatus: "rejected" as const, rejectionReason: reason } : {}),
        })
        .where(eq(prospects.id, id));
      result.resolved.push(id);
    }

    if (result.resolved.length) {
      await recordEvent(tx, {
        eventType: "prospect.resolved",
        entityType: "endeavour",
        entityId: input.endeavourId,
        endeavourId: input.endeavourId,
        subject: input.endeavourId,
        detail: `${result.resolved.length} prospect(s) ${input.resolution}${reason ? `: ${reason}` : ""}`,
        data: { resolution: input.resolution, ids: result.resolved, at: now.toISOString() },
      });
    }
    return result;
  }, { isolationLevel: "read committed" });
}
