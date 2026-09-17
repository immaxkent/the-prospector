/**
 * Creating outreach drafts. A draft is stored only with the evidence it cites, and it enters
 * the approval queue or is discarded according to the endeavour's autonomy level.
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import type { Database } from "../db/client";
import { approvals, endeavours, messages, people, prospects, threads } from "../db/schema";
import { routeDraft, type MessageClass } from "../domain/outbound";
import { newId } from "../ids";
import { conflict, notFound } from "./errors";
import { recordEvent, type Executor } from "./events";

export interface CreateDraftInput {
  prospectId: string;
  subject: string;
  body: string;
  evidenceIds: string[];
  messageClass: MessageClass;
  templateVersion: string;
  why?: string;
  runId?: string | null;
}

/** One thread per prospect and mailbox, so a follow-up stays in the same conversation. */
async function threadFor(tx: Executor, prospectId: string, endeavourId: string, mailboxId: string, subject: string) {
  const [existing] = await tx
    .select()
    .from(threads)
    .where(and(eq(threads.prospectId, prospectId), eq(threads.mailboxId, mailboxId)))
    .orderBy(desc(threads.lastActivityAt));
  if (existing) return existing.id;
  const id = newId("thread");
  await tx.insert(threads).values({ id, mailboxId, endeavourId, prospectId, subject, mappingState: "mapped" });
  return id;
}

export async function createOutreachDraft(db: Database, input: CreateDraftInput, now = new Date()) {
  return db.transaction(async (tx) => {
    const [prospect] = await tx.select().from(prospects).where(eq(prospects.id, input.prospectId)).for("update");
    if (!prospect) throw notFound("prospect");
    if (prospect.reviewStatus === "rejected") throw conflict("this prospect is rejected");

    const [endeavour] = await tx.select().from(endeavours).where(eq(endeavours.id, prospect.endeavourId));
    if (!endeavour) throw notFound("endeavour");
    if (!endeavour.mailboxId) throw conflict("the endeavour has no sending mailbox");

    const [person] = prospect.personId ? await tx.select().from(people).where(eq(people.id, prospect.personId)) : [];
    if (!person?.email) throw conflict("this prospect has no email address");

    const open = await tx
      .select({ id: messages.id })
      .from(messages)
      .where(and(eq(messages.prospectId, prospect.id), inArray(messages.sendState, ["drafted", "pending_approval", "approved", "queued", "sending"])));
    if (open.length > 0) throw conflict("a message for this prospect is already waiting");

    const route = routeDraft({
      autonomyLevel: endeavour.autonomyLevel,
      messageClass: input.messageClass,
      novelCopy: true,
      sensitive: false,
    });
    if (route === "discard") {
      await recordEvent(tx, {
        eventType: "message.discarded",
        entityType: "prospect",
        entityId: prospect.id,
        endeavourId: endeavour.id,
        detail: "autonomy is OBSERVE: research only, no outreach",
      });
      return { created: false as const, reason: "autonomy_observe" as const };
    }

    const threadId = await threadFor(tx, prospect.id, endeavour.id, endeavour.mailboxId, input.subject);
    const messageId = newId("message");
    await tx.insert(messages).values({
      id: messageId,
      threadId,
      endeavourId: endeavour.id,
      prospectId: prospect.id,
      direction: "outbound",
      messageClass: input.messageClass,
      subject: input.subject,
      body: input.body,
      templateVersion: input.templateVersion,
      evidenceIds: input.evidenceIds,
      sendState: route === "approved" ? "approved" : "pending_approval",
      ...(route === "approved" ? { approvedAt: now } : {}),
    });

    if (route === "pending_approval") {
      await tx.insert(approvals).values({
        id: newId("approval"),
        endeavourId: endeavour.id,
        kind: "outreach_draft",
        subjectType: "message",
        subjectId: messageId,
        payload: {
          why: input.why ?? "",
          evidenceIds: input.evidenceIds,
          recipient: `${person.name} <${person.email}>`,
        },
      });
    }
    await recordEvent(tx, {
      eventType: "message.drafted",
      entityType: "message",
      entityId: messageId,
      endeavourId: endeavour.id,
      subject: input.subject,
      detail: `${input.messageClass} for ${person.name}`,
      data: { runId: input.runId ?? null },
    });
    return { created: true as const, messageId, threadId, needsApproval: route === "pending_approval" };
  });
}
