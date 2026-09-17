/**
 * Applying what a reply said. The reply itself is never rewritten: the reading is stored
 * alongside it. An unsubscribe stops outreach immediately; anything else may become a
 * suggested reply for the operator to approve (handoff §10).
 */
import { and, eq, inArray } from "drizzle-orm";
import type { ReplyClassification } from "../agent/reply";
import type { Database } from "../db/client";
import { approvals, messages, people, prospects, suppressions, threads } from "../db/schema";
import { assertTransition } from "../domain/pipeline";
import { newId } from "../ids";
import { notFound } from "./errors";
import { recordEvent, type Executor } from "./events";

export interface ApplyReplyInput {
  messageId: string;
  classification: ReplyClassification;
  now?: Date;
}

async function stopOutreach(tx: Executor, prospectId: string, reason: string, now: Date) {
  const [prospect] = await tx.select().from(prospects).where(eq(prospects.id, prospectId));
  if (!prospect) return;
  const [person] = prospect.personId ? await tx.select().from(people).where(eq(people.id, prospect.personId)) : [];
  if (person?.email) {
    await tx
      .insert(suppressions)
      .values({ id: newId("suppression"), kind: "email", value: person.email.toLowerCase(), reason })
      .onConflictDoNothing({ target: [suppressions.kind, suppressions.value] });
  }
  const pending = await tx
    .select({ id: messages.id })
    .from(messages)
    .where(and(eq(messages.prospectId, prospectId), inArray(messages.sendState, ["drafted", "pending_approval", "approved", "queued"])));
  const ids = pending.map((p) => p.id);
  if (ids.length) {
    await tx.update(messages).set({ sendState: "rejected", lastError: reason }).where(inArray(messages.id, ids));
    await tx
      .update(approvals)
      .set({ status: "rejected", decidedAt: now, decisionNote: reason })
      .where(and(eq(approvals.subjectType, "message"), inArray(approvals.subjectId, ids), eq(approvals.status, "pending")));
  }
  try {
    assertTransition(prospect.stage, "lost", "system");
    await tx.update(prospects).set({ stage: "lost" }).where(eq(prospects.id, prospectId));
  } catch {
    // Terminal already; the suppression is what matters.
  }
  await tx
    .update(prospects)
    .set({ reviewStatus: "rejected", rejectionReason: reason, nextAction: null, nextActionAt: null })
    .where(eq(prospects.id, prospectId));
}

export async function applyReplyClassification(db: Database, input: ApplyReplyInput) {
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const [message] = await tx.select().from(messages).where(eq(messages.id, input.messageId)).for("update");
    if (!message) throw notFound("message");
    const c = input.classification;

    await tx.update(messages).set({ classification: c }).where(eq(messages.id, message.id));
    await tx.update(threads).set({ intent: c.summary }).where(eq(threads.id, message.threadId));

    if (c.unsubscribeRequested) {
      if (message.prospectId) await stopOutreach(tx, message.prospectId, "Asked not to be contacted", now);
      await recordEvent(tx, {
        eventType: "prospect.unsubscribed",
        entityType: "message",
        entityId: message.id,
        endeavourId: message.endeavourId,
        detail: c.summary,
      });
      return { outcome: "unsubscribed" as const };
    }

    if (!c.suggestedReply) {
      await recordEvent(tx, {
        eventType: "message.classified",
        entityType: "message",
        entityId: message.id,
        endeavourId: message.endeavourId,
        detail: `${c.intent}: ${c.summary}`,
      });
      return { outcome: "no_reply_needed" as const };
    }

    const [open] = await tx
      .select({ id: approvals.id })
      .from(approvals)
      .where(
        and(
          eq(approvals.kind, "reply_approval"),
          eq(approvals.subjectType, "thread"),
          eq(approvals.subjectId, message.threadId),
          eq(approvals.status, "pending"),
        ),
      );
    if (open) return { outcome: "already_waiting" as const };

    await tx.insert(approvals).values({
      id: newId("approval"),
      endeavourId: message.endeavourId ?? "",
      kind: "reply_approval",
      subjectType: "thread",
      subjectId: message.threadId,
      payload: {
        draft: c.suggestedReply,
        why: c.summary,
        objections: c.objections,
        requestedNextStep: c.requestedNextStep,
      },
    });
    await recordEvent(tx, {
      eventType: "message.classified",
      entityType: "message",
      entityId: message.id,
      endeavourId: message.endeavourId,
      detail: `${c.intent}: ${c.summary}`,
    });
    return { outcome: "reply_queued" as const };
  });
}
