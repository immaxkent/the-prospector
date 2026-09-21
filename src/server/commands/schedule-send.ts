/**
 * Giving an approved message its slot.
 *
 * A slot is assigned once, when the message is approved, rather than at send time: it means the
 * queue is visible before anything goes out, and two messages approved in the same second cannot
 * both claim the same moment. The mailbox is the unit of spacing, because that is what the
 * provider sees — several endeavours sharing an address share its rhythm.
 */
import { and, desc, eq, gte, inArray, isNotNull } from "drizzle-orm";
import { companies, endeavours, mailboxes, messages, prospects, threads } from "../db/schema";
import { normaliseSettings } from "../domain/endeavour-settings";
import { earliestReplyAt, nextSlot, type Random } from "../domain/pacing";
import type { Executor } from "./events";

/** States that still hold a slot: anything already sent or abandoned no longer paces the queue. */
const PENDING_STATES = ["approved", "queued", "sending"] as const;

export interface ScheduleInput {
  messageId: string;
  now: Date;
  random?: Random;
}

/**
 * Works out when this message should go, and stores it. Returns the slot, or null when the
 * message has no mailbox to pace against — a message with nowhere to go is left unscheduled
 * rather than given a fictitious time.
 */
export async function scheduleSend(tx: Executor, input: ScheduleInput) {
  const [message] = await tx.select().from(messages).where(eq(messages.id, input.messageId));
  if (!message || message.direction !== "outbound") return null;

  const [thread] = await tx.select().from(threads).where(eq(threads.id, message.threadId));
  const mailboxId = thread?.mailboxId;
  if (!mailboxId) return null;
  const [mailbox] = await tx.select().from(mailboxes).where(eq(mailboxes.id, mailboxId));
  if (!mailbox) return null;

  const [endeavour] = message.endeavourId
    ? await tx.select().from(endeavours).where(eq(endeavours.id, message.endeavourId))
    : [];
  const settings = normaliseSettings(endeavour?.settings);

  // A reply waits a decent interval after the message it answers.
  const [lastInbound] = await tx
    .select({ receivedAt: messages.receivedAt })
    .from(messages)
    .where(and(eq(messages.threadId, message.threadId), eq(messages.direction, "inbound"), isNotNull(messages.receivedAt)))
    .orderBy(desc(messages.receivedAt))
    .limit(1);
  const earliest =
    message.messageClass === "reply"
      ? earliestReplyAt(lastInbound?.receivedAt ?? null, input.now, settings.pacing)
      : input.now;

  // The latest slot already promised on this mailbox, whichever endeavour asked for it.
  const [previous] = await tx
    .select({ at: messages.scheduledSendAt })
    .from(messages)
    .innerJoin(threads, eq(threads.id, messages.threadId))
    .where(
      and(
        eq(threads.mailboxId, mailboxId),
        isNotNull(messages.scheduledSendAt),
        inArray(messages.sendState, [...PENDING_STATES]),
        gte(messages.scheduledSendAt, input.now),
      ),
    )
    .orderBy(desc(messages.scheduledSendAt))
    .limit(1);

  const slot = nextSlot({
    earliest,
    previousSlot: previous?.at ?? null,
    recipientTimezone: await recipientTimezone(tx, message.prospectId),
    mailboxTimezone: mailbox.limits.timezone,
    pacing: settings.pacing,
    ...(input.random ? { random: input.random } : {}),
  });

  await tx.update(messages).set({ scheduledSendAt: slot.at }).where(eq(messages.id, message.id));
  return slot;
}

/** Where the recipient works, when research established it. */
async function recipientTimezone(tx: Executor, prospectId: string | null) {
  if (!prospectId) return null;
  const [row] = await tx
    .select({ timezone: companies.timezone })
    .from(prospects)
    .leftJoin(companies, eq(companies.id, prospects.companyId))
    .where(eq(prospects.id, prospectId));
  return row?.timezone ?? null;
}
