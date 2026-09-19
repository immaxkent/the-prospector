/**
 * Sending approved outreach. Caps and quiet hours belong to the mailbox and are shared by
 * every endeavour on it. Nothing is sent that a human has not approved, and every outcome
 * is written down: no send fails silently (handoff §5, §13).
 */
import { and, desc, eq, gte, inArray, isNotNull } from "drizzle-orm";
import type { Database } from "../db/client";
import { endeavours, mailboxes, messages, people, prospects, suppressions, threads } from "../db/schema";
import { allocateSends, effectiveDailyCap, isQuietHour, remainingSends, type MailboxAlias } from "../domain/mailbox";
import { assertMove, MAX_SEND_ATTEMPTS } from "../domain/outbound";
import { assertTransition } from "../domain/pipeline";
import { sealJson, unsealJson } from "../crypto/tokens";
import { GmailClient, GmailError, type GmailContext } from "../mailboxes/gmail";
import { buildRawMessage } from "../mailboxes/message";
import type { GoogleTokenSet } from "./mailboxes";
import { conflict, notFound } from "./errors";
import { recordEvent } from "./events";
import { localDate } from "../read/rows";

export interface SendOutcome {
  sent: number;
  failed: number;
  suppressed: number;
  skipped: "quiet_hours" | "no_capacity" | "nothing_approved" | null;
  capacity: number;
}

export interface SendDeps {
  clientId: string;
  clientSecret: string;
  tokenKey: Buffer;
  /** Replaced in tests; production uses the real Gmail API. */
  createClient?: (ctx: GmailContext) => GmailClient;
  fetchImpl?: GmailContext["fetchImpl"];
}

/**
 * The address this endeavour sends under. An alias the mailbox no longer holds is ignored
 * rather than used: sending from an address Google has not accepted would bounce.
 */
function ownerAlias(
  owners: readonly { id: string; fromAlias: string | null }[],
  aliases: readonly MailboxAlias[],
  endeavourId: string,
) {
  const wanted = owners.find((o) => o.id === endeavourId)?.fromAlias?.toLowerCase();
  if (!wanted) return null;
  return aliases.find((a) => a.address.toLowerCase() === wanted) ?? null;
}

/** Follow-up is due three working-ish days later; the follow-up engine refines this. */
const REPLY_WAIT_MS = 3 * 86_400_000;

export async function sendApprovedForMailbox(
  db: Database,
  deps: SendDeps,
  input: { mailboxId: string; now?: Date },
): Promise<SendOutcome> {
  const now = input.now ?? new Date();
  const [mailbox] = await db.select().from(mailboxes).where(eq(mailboxes.id, input.mailboxId));
  if (!mailbox) throw notFound("mailbox");
  if (mailbox.status !== "connected" || !mailbox.tokenCiphertext) throw conflict(`${mailbox.address} is not connected`);

  const outcome: SendOutcome = { sent: 0, failed: 0, suppressed: 0, skipped: null, capacity: 0 };
  if (isQuietHour(mailbox.limits, now)) return { ...outcome, skipped: "quiet_hours" };

  const today = localDate(now, mailbox.limits.timezone);
  const since = new Date(now.getTime() - 7 * 86_400_000);
  const sentRows = await db
    .select({ id: messages.id, sentAt: messages.sentAt })
    .from(messages)
    .innerJoin(threads, eq(threads.id, messages.threadId))
    .where(and(eq(threads.mailboxId, mailbox.id), eq(messages.sendState, "sent"), gte(messages.sentAt, since)));
  const usage = {
    sentToday: sentRows.filter((r) => r.sentAt && localDate(r.sentAt, mailbox.limits.timezone) === today).length,
    sentLast7Days: sentRows.length,
  };
  const capacity = remainingSends(mailbox.limits, usage, today);
  outcome.capacity = capacity;
  if (capacity === 0) return { ...outcome, skipped: "no_capacity" };

  const owners = await db
    .select({ id: endeavours.id, fromAlias: endeavours.fromAlias })
    .from(endeavours)
    .where(eq(endeavours.mailboxId, mailbox.id));
  if (owners.length === 0) return { ...outcome, skipped: "nothing_approved" };

  const approved = await db
    .select()
    .from(messages)
    .where(
      and(
        eq(messages.sendState, "approved"),
        inArray(messages.endeavourId, owners.map((o) => o.id)),
        isNotNull(messages.prospectId),
      ),
    )
    .orderBy(messages.approvedAt);
  if (approved.length === 0) return { ...outcome, skipped: "nothing_approved" };

  // Capacity is split between the endeavours sharing this mailbox.
  const requests = [...new Set(approved.map((m) => m.endeavourId))].map((id) => ({
    endeavourId: id!,
    requested: approved.filter((m) => m.endeavourId === id).length,
    priority: 1,
  }));
  const allowance = allocateSends(capacity, requests);
  const used = new Map<string, number>();

  const gmail = (deps.createClient ?? ((ctx) => new GmailClient(ctx)))({
    clientId: deps.clientId,
    clientSecret: deps.clientSecret,
    tokens: unsealJson<GoogleTokenSet>(mailbox.tokenCiphertext, deps.tokenKey),
    ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
  });

  for (const message of approved) {
    const endeavourId = message.endeavourId!;
    const granted = allowance.get(endeavourId) ?? 0;
    const spent = used.get(endeavourId) ?? 0;
    if (spent >= granted) continue;

    const [prospect] = await db.select().from(prospects).where(eq(prospects.id, message.prospectId!));
    const [person] = prospect?.personId ? await db.select().from(people).where(eq(people.id, prospect.personId)) : [];
    if (!person?.email) {
      await db.update(messages).set({ sendState: "failed", lastError: "no email address for this prospect" }).where(eq(messages.id, message.id));
      outcome.failed += 1;
      continue;
    }

    const email = person.email.toLowerCase();
    const domain = email.slice(email.lastIndexOf("@") + 1);
    const blocked = await db.select({ id: suppressions.id }).from(suppressions).where(inArray(suppressions.value, [email, domain]));
    if (blocked.length > 0) {
      await db.update(messages).set({ sendState: "rejected", lastError: "recipient is on the do-not-contact list" }).where(eq(messages.id, message.id));
      await recordEvent(db, {
        eventType: "message.suppressed",
        entityType: "message",
        entityId: message.id,
        endeavourId,
        detail: `${email} is suppressed`,
      });
      outcome.suppressed += 1;
      continue;
    }

    const [thread] = await db.select().from(threads).where(eq(threads.id, message.threadId));
    const [lastInbound] = await db
      .select({ externalMessageId: messages.externalMessageId })
      .from(messages)
      .where(and(eq(messages.threadId, message.threadId), eq(messages.direction, "inbound")))
      .orderBy(desc(messages.receivedAt))
      .limit(1);

    assertMove(message.sendState ?? "approved", "queued");
    await db.update(messages).set({ sendState: "queued" }).where(eq(messages.id, message.id));
    assertMove("queued", "sending");
    await db
      .update(messages)
      .set({ sendState: "sending", sendAttempts: message.sendAttempts + 1 })
      .where(eq(messages.id, message.id));

    // An endeavour may send under one of the mailbox's aliases; the account still owns the send.
    const alias = ownerAlias(owners, mailbox.aliases, endeavourId);
    const raw = buildRawMessage({
      fromName: alias?.displayName ?? mailbox.displayName,
      fromAddress: alias?.address ?? mailbox.address,
      toName: person.name,
      toAddress: person.email,
      subject: message.subject,
      body: message.body,
      inReplyTo: lastInbound?.externalMessageId ?? null,
      unsubscribeMailto: alias?.address ?? mailbox.address,
    });

    try {
      const result = await gmail.send(raw, thread?.externalThreadId ?? null);
      await db
        .update(messages)
        .set({
          sendState: "sent",
          sentAt: now,
          externalMessageId: result.externalMessageId,
          lastError: null,
        })
        .where(eq(messages.id, message.id));
      await db
        .update(threads)
        .set({ externalThreadId: result.externalThreadId, lastActivityAt: now })
        .where(eq(threads.id, message.threadId));

      if (prospect && prospect.stage !== "contacted") {
        try {
          assertTransition(prospect.stage, "contacted", "system");
          await db
            .update(prospects)
            .set({ stage: "contacted", nextAction: "Awaiting reply", nextActionAt: new Date(now.getTime() + REPLY_WAIT_MS) })
            .where(eq(prospects.id, prospect.id));
        } catch {
          // Already further along: leave the stage as it is.
        }
      }
      await recordEvent(db, {
        eventType: "message.sent",
        entityType: "message",
        entityId: message.id,
        endeavourId,
        subject: message.subject,
        detail: `sent to ${person.email}`,
      });
      used.set(endeavourId, spent + 1);
      outcome.sent += 1;
    } catch (err) {
      const gmailError = err instanceof GmailError ? err : null;
      const retryable = gmailError?.retryable ?? true;
      const attemptsLeft = message.sendAttempts + 1 < MAX_SEND_ATTEMPTS;
      await db
        .update(messages)
        .set({
          sendState: retryable && attemptsLeft ? "approved" : "failed",
          lastError: err instanceof Error ? err.message.slice(0, 500) : String(err),
        })
        .where(eq(messages.id, message.id));
      if (gmailError && (gmailError.status === 401 || gmailError.status === 403)) {
        await db.update(mailboxes).set({ status: "needs_reauth" }).where(eq(mailboxes.id, mailbox.id));
      }
      await recordEvent(db, {
        eventType: "message.send_failed",
        entityType: "message",
        entityId: message.id,
        endeavourId,
        detail: err instanceof Error ? err.message : String(err),
      });
      outcome.failed += 1;
      if (gmailError && !gmailError.retryable && gmailError.status >= 400 && gmailError.status < 500) break;
    }
  }

  if (gmail.tokensChanged) {
    await db.update(mailboxes).set({ tokenCiphertext: sealJson(gmail.currentTokens, deps.tokenKey) }).where(eq(mailboxes.id, mailbox.id));
  }
  return outcome;
}

/** Effective cap for display and logging. */
export const capToday = (limits: Parameters<typeof effectiveDailyCap>[0], today: string) => effectiveDailyCap(limits, today);
