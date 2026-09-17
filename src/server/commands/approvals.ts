/**
 * Human decisions on the approval queue. Approving copy never sends it:
 * it moves the message to `approved`, and the send worker (W10) queues it within mailbox caps.
 */
import { and, eq } from "drizzle-orm";
import type { Database } from "../db/client";
import { approvals, messages, prospects, threads } from "../db/schema";
import { assertMove } from "../domain/outbound";
import { newId } from "../ids";
import { conflict, invalid, notFound } from "./errors";
import { recordEvent, type Executor } from "./events";

export interface DecideApprovalInput {
  approvalId: string;
  decision: "approve" | "reject";
  /** Replaces the drafted copy before approving. */
  editedCopy?: string | undefined;
  note?: string | undefined;
  /** Required to approve a thread_mapping approval. */
  prospectId?: string | undefined;
}

async function loadPending(tx: Executor, id: string) {
  const [row] = await tx.select().from(approvals).where(eq(approvals.id, id)).for("update");
  if (!row) throw notFound("approval");
  if (row.status !== "pending") throw conflict(`approval was already ${row.status}`);
  return row;
}

export async function decideApproval(db: Database, input: DecideApprovalInput, now = new Date()) {
  const copy = input.editedCopy?.trim();
  if (input.editedCopy !== undefined && !copy) throw invalid("edited copy cannot be empty");

  return db.transaction(async (tx) => {
    const approval = await loadPending(tx, input.approvalId);
    const approve = input.decision === "approve";

    switch (approval.kind) {
      case "outreach_draft": {
        const [message] = await tx.select().from(messages).where(eq(messages.id, approval.subjectId)).for("update");
        if (!message) throw notFound("draft message");
        const to = approve ? "approved" : "rejected";
        assertMove(message.sendState ?? "drafted", to);
        await tx
          .update(messages)
          .set({ sendState: to, ...(approve && copy ? { body: copy } : {}), ...(approve ? { approvedAt: now } : {}) })
          .where(eq(messages.id, message.id));
        await recordEvent(tx, {
          eventType: approve ? "message.approved" : "message.rejected",
          entityType: "message",
          entityId: message.id,
          endeavourId: approval.endeavourId,
          subject: message.subject,
          detail: approve ? (copy ? "Approved with edits" : "Approved") : (input.note ?? "Rejected"),
        });
        break;
      }

      case "reply_approval": {
        if (!approve) break;
        const [thread] = await tx.select().from(threads).where(eq(threads.id, approval.subjectId));
        if (!thread) throw notFound("thread");
        const draft = copy ?? (typeof approval.payload["draft"] === "string" ? approval.payload["draft"] : "");
        if (!draft.trim()) throw invalid("there is no reply copy to approve");
        const id = newId("message");
        await tx.insert(messages).values({
          id,
          threadId: thread.id,
          endeavourId: thread.endeavourId,
          prospectId: thread.prospectId,
          direction: "outbound",
          messageClass: "reply",
          subject: thread.subject.startsWith("Re:") ? thread.subject : `Re: ${thread.subject}`,
          body: draft,
          evidenceIds: Array.isArray(approval.payload["evidenceIds"]) ? (approval.payload["evidenceIds"] as string[]) : [],
          sendState: "approved",
          approvedAt: now,
        });
        await recordEvent(tx, {
          eventType: "message.approved",
          entityType: "message",
          entityId: id,
          endeavourId: approval.endeavourId,
          subject: thread.subject,
          detail: copy ? "Reply approved with edits" : "Reply approved",
        });
        break;
      }

      case "thread_mapping": {
        const [thread] = await tx.select().from(threads).where(eq(threads.id, approval.subjectId));
        if (!thread) throw notFound("thread");
        if (approve) {
          if (!input.prospectId) throw invalid("choose the prospect this reply belongs to");
          const [prospect] = await tx.select().from(prospects).where(eq(prospects.id, input.prospectId));
          if (!prospect) throw notFound("prospect");
          await tx
            .update(threads)
            .set({ mappingState: "mapped", prospectId: prospect.id, endeavourId: prospect.endeavourId })
            .where(eq(threads.id, thread.id));
          await tx
            .update(messages)
            .set({ prospectId: prospect.id, endeavourId: prospect.endeavourId })
            .where(eq(messages.threadId, thread.id));
        } else {
          await tx.update(threads).set({ mappingState: "ignored" }).where(eq(threads.id, thread.id));
        }
        break;
      }

      case "hot_lead":
      case "pricing_decision":
      case "failed_run":
        // Acknowledgements: the decision itself is the record.
        break;
    }

    const [decided] = await tx
      .update(approvals)
      .set({ status: approve ? "approved" : "rejected", decidedAt: now, decisionNote: input.note ?? null })
      .where(and(eq(approvals.id, approval.id), eq(approvals.status, "pending")))
      .returning();
    await recordEvent(tx, {
      eventType: "approval.decided",
      entityType: "approval",
      entityId: approval.id,
      endeavourId: approval.endeavourId,
      data: { kind: approval.kind, decision: input.decision },
    });
    return decided!;
  });
}
