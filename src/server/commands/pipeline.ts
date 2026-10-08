import { eq } from "drizzle-orm";
import type { Database } from "../db/client";
import { endeavours, opportunities, prospects, threads } from "../db/schema";
import { conflict, invalid, notFound } from "./errors";
import { recordEvent } from "./events";

export interface OpportunityUpdate {
  opportunityId: string;
  value?: number | undefined;
  probability?: number | null | undefined;
  expectedClose?: string | null | undefined;
  /**
   * Move it along the pipeline without closing it.
   *
   * Closing goes through `outcome`, which requires a reason — a deal that reached "won" by a
   * dropdown with nothing recorded teaches nobody anything, and won feeds the objective.
   */
  stage?: OpenStage | undefined;
  outcome?: { stage: "won" | "lost"; reason: string } | undefined;
}

/** The stages a deal can be moved to here. Won and lost need a reason, so they are not among them. */
export const OPEN_DEAL_STAGES = [
  "qualified",
  "contacted",
  "replied",
  "meeting",
  "proposal",
  "nurture",
] as const;
export type OpenStage = (typeof OPEN_DEAL_STAGES)[number];

export async function updateOpportunity(db: Database, input: OpportunityUpdate) {
  if (input.value !== undefined && (!Number.isInteger(input.value) || input.value < 0))
    throw invalid("value must be a whole, non-negative amount");
  if (input.probability != null && (input.probability < 0 || input.probability > 1))
    throw invalid("probability must be between 0 and 1");
  if (input.stage && input.outcome) throw invalid("move it or close it, not both in one go");
  return db.transaction(async (tx) => {
    const [opp] = await tx
      .select()
      .from(opportunities)
      .where(eq(opportunities.id, input.opportunityId))
      .for("update");
    if (!opp) throw notFound("opportunity");
    const alreadyClosed = opp.stage === "won" || opp.stage === "lost";
    if (input.outcome && alreadyClosed) throw conflict(`opportunity is already ${opp.stage}`);
    // Reopening a closed deal would silently take value back out of the objective.
    if (input.stage && alreadyClosed) throw conflict(`opportunity is already ${opp.stage}`);
    await tx
      .update(opportunities)
      .set({
        ...(input.value !== undefined ? { value: input.value } : {}),
        ...(input.probability !== undefined ? { probabilityUserDefined: input.probability } : {}),
        ...(input.expectedClose !== undefined ? { expectedClose: input.expectedClose } : {}),
        ...(input.stage ? { stage: input.stage } : {}),
        ...(input.outcome
          ? { stage: input.outcome.stage, outcomeReason: input.outcome.reason }
          : {}),
      })
      .where(eq(opportunities.id, opp.id));
    /*
     * The prospect follows the deal.
     *
     * They were two records saying different things about the same conversation: a deal at
     * "proposal" whose prospect was still "contacted" made the funnel and the pipeline
     * disagree, and the funnel is what the objective's pacing reads.
     */
    const movedTo = input.outcome?.stage ?? input.stage;
    if (movedTo && opp.prospectId) {
      await tx.update(prospects).set({ stage: movedTo }).where(eq(prospects.id, opp.prospectId));
    }
    await recordEvent(tx, {
      eventType:
        input.outcome?.stage === "won"
          ? "opportunity.won"
          : input.outcome?.stage === "lost"
            ? "opportunity.lost"
            : "opportunity.updated",
      entityType: "opportunity",
      entityId: opp.id,
      endeavourId: opp.endeavourId,
      subject: opp.name,
      detail: input.outcome
        ? `${input.outcome.stage}: ${input.outcome.reason}`
        : input.stage
          ? `Moved to ${input.stage}`
          : "Updated",
    });
  });
}

const ENDEAVOUR_TRANSITIONS: Record<string, readonly string[]> = {
  draft: ["archived"],
  active: ["paused", "archived"],
  paused: ["active", "archived"],
  archived: [],
};

/** Activation from draft goes through the intake gate (W7), never through here. */
export async function setEndeavourStatus(
  db: Database,
  input: { endeavourId: string; status: "active" | "paused" | "archived" },
) {
  return db.transaction(async (tx) => {
    const [e] = await tx
      .select()
      .from(endeavours)
      .where(eq(endeavours.id, input.endeavourId))
      .for("update");
    if (!e) throw notFound("endeavour");
    if (!ENDEAVOUR_TRANSITIONS[e.status]!.includes(input.status))
      throw conflict(
        `an ${e.status} endeavour cannot be ${input.status === "active" ? "resumed" : input.status}`,
      );
    await tx.update(endeavours).set({ status: input.status }).where(eq(endeavours.id, e.id));
    await recordEvent(tx, {
      eventType: `endeavour.${input.status === "active" ? "resumed" : input.status}`,
      entityType: "endeavour",
      entityId: e.id,
      endeavourId: e.id,
      subject: e.name,
    });
  });
}

export async function markThreadRead(
  db: Database,
  input: { threadId: string; unread?: boolean | undefined },
) {
  const [row] = await db
    .update(threads)
    .set({ unread: input.unread ?? false })
    .where(eq(threads.id, input.threadId))
    .returning({ id: threads.id });
  if (!row) throw notFound("thread");
}
