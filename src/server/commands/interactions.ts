/**
 * Recording contact that did not go through the mailbox.
 *
 * An address may never have been found, or the conversation may be happening on Discord,
 * LinkedIn or a call. None of that is visible to a system watching one inbox, and without
 * it the counters are wrong in the worst direction: a prospect already in talks reads as
 * pending forever, holding a slot and keeping the buffer full.
 *
 * What this never does is touch the conversion rates. Those are built from `messages`, and
 * an interaction is a row in its own table — so a Discord conversation cannot be counted as
 * a reply to an email nobody sent, which would inflate the reply rate and quietly tell the
 * system that fewer prospects were needed.
 */
import { eq } from "drizzle-orm";
import type { Database } from "../db/client";
import { interactions, prospects } from "../db/schema";
import { PROGRESSION, assertTransition, type PipelineStage } from "../domain/pipeline";
import { newId } from "../ids";
import { conflict, invalid, notFound } from "./errors";
import { recordEvent } from "./events";

export const INTERACTION_CHANNELS = ["discord", "linkedin", "x", "call", "in_person", "email", "other"] as const;
export type InteractionChannel = (typeof INTERACTION_CHANNELS)[number];

export interface LogInteractionInput {
  prospectId: string;
  channel: InteractionChannel;
  direction: "outbound" | "inbound";
  occurredAt: Date;
  note?: string | null;
}

/**
 * Where an interaction leaves the prospect.
 *
 * Outbound means they have been approached, inbound means they answered. Neither ever moves
 * a prospect backwards: a prospect already at `meeting` does not return to `replied` because
 * another message arrived.
 */
function stageAfter(current: PipelineStage, direction: "outbound" | "inbound"): PipelineStage {
  const wanted: PipelineStage = direction === "inbound" ? "replied" : "contacted";
  const here = PROGRESSION.indexOf(current);
  const there = PROGRESSION.indexOf(wanted);
  // Off the main line — nurture, lost, won — is the operator's own placement, and an
  // interaction is not grounds to overrule it.
  if (here === -1) return current;
  return there > here ? wanted : current;
}

export async function logInteraction(db: Database, input: LogInteractionInput, now = new Date()) {
  if (input.occurredAt.getTime() > now.getTime() + 60_000) {
    throw invalid("an interaction cannot have happened in the future");
  }

  return db.transaction(async (tx) => {
    const [prospect] = await tx.select().from(prospects).where(eq(prospects.id, input.prospectId)).for("update");
    if (!prospect) throw notFound("prospect");
    if (prospect.reviewStatus === "rejected") throw conflict("this prospect was rejected; restore it before logging contact");

    const id = newId("interaction");
    await tx.insert(interactions).values({
      id,
      endeavourId: prospect.endeavourId,
      prospectId: prospect.id,
      channel: input.channel,
      direction: input.direction,
      occurredAt: input.occurredAt,
      note: input.note?.trim() || null,
    });

    const next = stageAfter(prospect.stage, input.direction);
    if (next !== prospect.stage) {
      // The operator is doing this, so the user transition rules apply rather than the
      // agent's — they are allowed to say what happened on a call.
      assertTransition(prospect.stage, next, "user");
      await tx.update(prospects).set({ stage: next }).where(eq(prospects.id, prospect.id));
    }

    await recordEvent(tx, {
      eventType: "prospect.interaction_logged",
      entityType: "prospect",
      entityId: prospect.id,
      endeavourId: prospect.endeavourId,
      subject: prospect.id,
      detail: `${input.direction} on ${input.channel}${next === prospect.stage ? "" : ` · moved to ${next}`}`,
      data: { interactionId: id, channel: input.channel, direction: input.direction },
    });

    return { id, stage: next, moved: next !== prospect.stage };
  }, { isolationLevel: "read committed" });
}
