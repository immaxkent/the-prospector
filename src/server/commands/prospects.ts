import { and, eq, inArray } from "drizzle-orm";
import type { Database } from "../db/client";
import { approvals, messages, opportunities, people, prospects, suppressions } from "../db/schema";
import { assertTransition, StageTransitionError, type PipelineStage } from "../domain/pipeline";
import { newId } from "../ids";
import { conflict, invalid, notFound } from "./errors";
import { recordEvent, type Executor } from "./events";

async function loadProspect(tx: Executor, id: string) {
  const [row] = await tx.select().from(prospects).where(eq(prospects.id, id)).for("update");
  if (!row) throw notFound("prospect");
  return row;
}

/** Withdraws unsent drafts and their open approvals so nothing is sent to a rejected or suppressed prospect. */
async function withdrawDrafts(tx: Executor, prospectId: string, now: Date, note: string) {
  const drafts = await tx
    .select({ id: messages.id })
    .from(messages)
    .where(and(eq(messages.prospectId, prospectId), inArray(messages.sendState, ["drafted", "pending_approval", "approved"])));
  const ids = drafts.map((d) => d.id);
  if (ids.length === 0) return 0;
  await tx.update(messages).set({ sendState: "rejected" }).where(inArray(messages.id, ids));
  await tx
    .update(approvals)
    .set({ status: "rejected", decidedAt: now, decisionNote: note })
    .where(and(eq(approvals.subjectType, "message"), inArray(approvals.subjectId, ids), eq(approvals.status, "pending")));
  return ids.length;
}

export async function rejectProspect(db: Database, input: { prospectId: string; reason: string }, now = new Date()) {
  const reason = input.reason.trim();
  if (!reason) throw invalid("give a reason for rejecting this prospect");
  return db.transaction(async (tx) => {
    const p = await loadProspect(tx, input.prospectId);
    if (p.reviewStatus === "rejected") throw conflict("prospect is already rejected");
    await tx
      .update(prospects)
      .set({ reviewStatus: "rejected", rejectionReason: reason, nextAction: null, nextActionAt: null })
      .where(eq(prospects.id, p.id));
    const withdrawn = await withdrawDrafts(tx, p.id, now, `Prospect rejected: ${reason}`);
    await recordEvent(tx, {
      eventType: "prospect.rejected",
      entityType: "prospect",
      entityId: p.id,
      endeavourId: p.endeavourId,
      detail: reason,
      data: { withdrawnDrafts: withdrawn },
    });
  });
}

export async function restoreProspect(db: Database, input: { prospectId: string }) {
  return db.transaction(async (tx) => {
    const p = await loadProspect(tx, input.prospectId);
    if (p.reviewStatus !== "rejected") throw conflict("prospect is not rejected");
    await tx.update(prospects).set({ reviewStatus: "needs_review", rejectionReason: null }).where(eq(prospects.id, p.id));
    await recordEvent(tx, { eventType: "prospect.restored", entityType: "prospect", entityId: p.id, endeavourId: p.endeavourId });
  });
}

/** Adds the person (or their whole domain) to the do-not-contact list and rejects the prospect. */
export async function suppressProspect(
  db: Database,
  input: { prospectId: string; scope: "email" | "domain"; reason: string },
  now = new Date(),
) {
  const reason = input.reason.trim() || "Suppressed by operator";
  return db.transaction(async (tx) => {
    const p = await loadProspect(tx, input.prospectId);
    const [person] = p.personId ? await tx.select().from(people).where(eq(people.id, p.personId)) : [];
    const email = person?.email?.toLowerCase();
    if (!email) throw invalid("this prospect has no email address to suppress");
    const value = input.scope === "email" ? email : email.slice(email.lastIndexOf("@") + 1);
    await tx
      .insert(suppressions)
      .values({ id: newId("suppression"), kind: input.scope, value, reason })
      .onConflictDoNothing({ target: [suppressions.kind, suppressions.value] });
    await tx
      .update(prospects)
      .set({ reviewStatus: "rejected", rejectionReason: `Suppressed: ${reason}`, nextAction: null, nextActionAt: null })
      .where(eq(prospects.id, p.id));
    await withdrawDrafts(tx, p.id, now, `Suppressed: ${reason}`);
    await recordEvent(tx, {
      eventType: "prospect.suppressed",
      entityType: "prospect",
      entityId: p.id,
      endeavourId: p.endeavourId,
      detail: `${input.scope} ${value}`,
    });
    return { kind: input.scope, value };
  });
}

export async function moveProspectStage(db: Database, input: { prospectId: string; to: PipelineStage }) {
  return db.transaction(async (tx) => {
    const p = await loadProspect(tx, input.prospectId);
    try {
      assertTransition(p.stage, input.to, "user");
    } catch (err) {
      if (err instanceof StageTransitionError) throw conflict(err.message);
      throw err;
    }
    await tx.update(prospects).set({ stage: input.to }).where(eq(prospects.id, p.id));
    if (input.to === "won" || input.to === "lost") {
      await tx
        .update(opportunities)
        .set({ stage: input.to })
        .where(and(eq(opportunities.prospectId, p.id), inArray(opportunities.stage, ["qualified", "contacted", "replied", "meeting", "proposal"])));
    }
    await recordEvent(tx, {
      eventType: input.to === "won" ? "opportunity.won" : input.to === "meeting" ? "prospect.meeting_set" : "prospect.stage_changed",
      entityType: "prospect",
      entityId: p.id,
      endeavourId: p.endeavourId,
      detail: `${p.stage} → ${input.to}`,
    });
  });
}
