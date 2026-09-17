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
  outcome?: { stage: "won" | "lost"; reason: string } | undefined;
}

export async function updateOpportunity(db: Database, input: OpportunityUpdate) {
  if (input.value !== undefined && (!Number.isInteger(input.value) || input.value < 0))
    throw invalid("value must be a whole, non-negative amount");
  if (input.probability != null && (input.probability < 0 || input.probability > 1))
    throw invalid("probability must be between 0 and 1");
  return db.transaction(async (tx) => {
    const [opp] = await tx.select().from(opportunities).where(eq(opportunities.id, input.opportunityId)).for("update");
    if (!opp) throw notFound("opportunity");
    if (input.outcome && (opp.stage === "won" || opp.stage === "lost"))
      throw conflict(`opportunity is already ${opp.stage}`);
    await tx
      .update(opportunities)
      .set({
        ...(input.value !== undefined ? { value: input.value } : {}),
        ...(input.probability !== undefined ? { probabilityUserDefined: input.probability } : {}),
        ...(input.expectedClose !== undefined ? { expectedClose: input.expectedClose } : {}),
        ...(input.outcome ? { stage: input.outcome.stage, outcomeReason: input.outcome.reason } : {}),
      })
      .where(eq(opportunities.id, opp.id));
    if (input.outcome && opp.prospectId) {
      await tx.update(prospects).set({ stage: input.outcome.stage }).where(eq(prospects.id, opp.prospectId));
    }
    await recordEvent(tx, {
      eventType: input.outcome?.stage === "won" ? "opportunity.won" : "opportunity.updated",
      entityType: "opportunity",
      entityId: opp.id,
      endeavourId: opp.endeavourId,
      subject: opp.name,
      detail: input.outcome ? `${input.outcome.stage}: ${input.outcome.reason}` : "Updated",
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
export async function setEndeavourStatus(db: Database, input: { endeavourId: string; status: "active" | "paused" | "archived" }) {
  return db.transaction(async (tx) => {
    const [e] = await tx.select().from(endeavours).where(eq(endeavours.id, input.endeavourId)).for("update");
    if (!e) throw notFound("endeavour");
    if (!ENDEAVOUR_TRANSITIONS[e.status]!.includes(input.status))
      throw conflict(`an ${e.status} endeavour cannot be ${input.status === "active" ? "resumed" : input.status}`);
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

export async function markThreadRead(db: Database, input: { threadId: string; unread?: boolean }) {
  const [row] = await db
    .update(threads)
    .set({ unread: input.unread ?? false })
    .where(eq(threads.id, input.threadId))
    .returning({ id: threads.id });
  if (!row) throw notFound("thread");
}
