/**
 * Reading replies. Gmail is a tool, not the record: we store stable ids and enough to
 * reconstruct the conversation. A reply we cannot confidently match goes to a review queue
 * rather than being attached to the wrong prospect (handoff §10).
 */
import { and, eq, ne } from "drizzle-orm";
import type { Database } from "../db/client";
import { approvals, companies, endeavours, mailboxes, messages, people, prospects, threads } from "../db/schema";
import { assertTransition } from "../domain/pipeline";
import { attributeReply, domainOf, isPublicDomain, replyAddress } from "../domain/attribution";
import { sealJson, unsealJson } from "../crypto/tokens";
import { newId } from "../ids";
import { conflict, notFound } from "../commands/errors";
import { recordEvent } from "../commands/events";
import type { GoogleTokenSet } from "../commands/mailboxes";
import { GmailClient, headerOf, plainTextOf, type GmailContext, type GmailMessage } from "./gmail";

export interface IngestDeps {
  clientId: string;
  clientSecret: string;
  tokenKey: Buffer;
  createClient?: (ctx: GmailContext) => GmailClient;
  fetchImpl?: GmailContext["fetchImpl"];
}

export interface IngestResult {
  fetched: number;
  stored: number;
  matched: number;
  needsReview: number;
  /** Needed review but no endeavour existed to attribute it to. Counted, never dropped. */
  unattributed: number;
  alreadyKnown: number;
}

/**
 * Any endeavour that could own an unmatched reply. Active first, because a paused or
 * archived endeavour is not somewhere to put work that has just arrived.
 */
async function anyActiveEndeavour(db: Database): Promise<string | null> {
  const [row] = await db.select({ id: endeavours.id }).from(endeavours).where(eq(endeavours.status, "active")).limit(1);
  return row?.id ?? null;
}

/** "Ilse Vermeer <ilse@x.com>" → ilse@x.com */
export function addressOf(header: string | null) {
  if (!header) return null;
  const match = header.match(/<([^>]+)>/);
  return (match?.[1] ?? header).trim().toLowerCase() || null;
}

export function nameOf(header: string | null) {
  if (!header) return null;
  const name = header.split("<")[0]?.trim().replace(/^"|"$/g, "");
  return name && !name.includes("@") ? name : null;
}

function receivedAt(message: GmailMessage) {
  const internal = message.internalDate ? Number(message.internalDate) : NaN;
  if (Number.isFinite(internal)) return new Date(internal);
  const date = headerOf(message, "date");
  const parsed = date ? Date.parse(date) : NaN;
  return Number.isFinite(parsed) ? new Date(parsed) : new Date();
}

/**
 * Pulls recent replies for one mailbox. Search covers a few days so a missed run catches up;
 * messages already stored are skipped by their Gmail id.
 */
export async function ingestReplies(
  db: Database,
  deps: IngestDeps,
  input: { mailboxId: string; now?: Date; lookbackDays?: number; max?: number },
): Promise<IngestResult> {
  const now = input.now ?? new Date();
  const [mailbox] = await db.select().from(mailboxes).where(eq(mailboxes.id, input.mailboxId));
  if (!mailbox) throw notFound("mailbox");
  if (mailbox.status !== "connected" || !mailbox.tokenCiphertext) throw conflict(`${mailbox.address} is not connected`);

  const gmail = (deps.createClient ?? ((ctx) => new GmailClient(ctx)))({
    clientId: deps.clientId,
    clientSecret: deps.clientSecret,
    tokens: unsealJson<GoogleTokenSet>(mailbox.tokenCiphertext, deps.tokenKey),
    ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
  });

  const result: IngestResult = { fetched: 0, stored: 0, matched: 0, needsReview: 0, unattributed: 0, alreadyKnown: 0 };
  const found = await gmail.list(`newer_than:${input.lookbackDays ?? 3}d -from:me -in:chats`, input.max ?? 25);
  result.fetched = found.length;

  for (const { id } of found) {
    const [existing] = await db.select({ id: messages.id }).from(messages).where(eq(messages.externalMessageId, id));
    if (existing) {
      result.alreadyKnown += 1;
      continue;
    }
    const message = await gmail.get(id);
    const from = addressOf(headerOf(message, "from"));
    const subject = headerOf(message, "subject") ?? "(no subject)";
    const body = plainTextOf(message);

    /*
     * Thread, then address, then the company's domain — and the reason is recorded.
     *
     * The domain step is new and is why the rest moved into `attributeReply`: a colleague
     * answering from the same company used to match nothing and sit in the review queue,
     * which is most of what a reply to a generic inbox looks like.
     */
    const [byThread] = await db
      .select()
      .from(threads)
      .where(and(eq(threads.mailboxId, mailbox.id), eq(threads.externalThreadId, message.threadId)));
    const [person] = from ? await db.select().from(people).where(eq(people.email, from)) : [];
    const [byPerson] = !byThread && person ? await db.select().from(prospects).where(eq(prospects.personId, person.id)) : [];

    const domain = byThread || byPerson ? null : domainOf(replyAddress(from));
    const atDomain =
      domain && !isPublicDomain(domain)
        ? await db
            .select({ id: prospects.id, endeavourId: prospects.endeavourId })
            .from(prospects)
            .innerJoin(companies, eq(prospects.companyId, companies.id))
            .where(and(eq(companies.domain, domain), ne(prospects.reviewStatus, "rejected")))
        : [];

    const attribution = attributeReply({
      from,
      candidate: {
        ...(byThread ? { thread: { id: byThread.id, prospectId: byThread.prospectId, endeavourId: byThread.endeavourId } } : {}),
        ...(byPerson ? { byAddress: { id: byPerson.id, endeavourId: byPerson.endeavourId } } : {}),
        byDomain: atDomain,
      },
    });

    let threadId = attribution.threadId;
    let prospectId = attribution.prospectId;
    let endeavourId = attribution.endeavourId;

    if (!threadId) {
      threadId = newId("thread");
      // A domain match is attributed but still asks a person: it is a guess, not a fact.
      const mapped = !!prospectId && !attribution.needsReview;
      await db.insert(threads).values({
        id: threadId,
        mailboxId: mailbox.id,
        endeavourId,
        prospectId,
        externalThreadId: message.threadId,
        subject,
        mappingState: mapped ? "mapped" : "needs_review",
        unread: true,
        lastActivityAt: receivedAt(message),
      });
      if (!mapped) {
        result.needsReview += 1;
        // The thread already carries needs_review, so the mail is never lost. The approval
        // is the ask to attribute it — and it has to belong to an endeavour, which an
        // unmatched message by definition does not name. Fall back to an active endeavour;
        // where there is none, leave the thread flagged rather than inventing an owner.
        //
        // This looked for one through `prospects`, so an install with no prospect yet found
        // nothing and wrote "" into a foreign key: every unmatched mail failed the job and
        // retried forever.
        const owner = endeavourId ?? (await anyActiveEndeavour(db));
        if (owner) {
          await db.insert(approvals).values({
            id: newId("approval"),
            endeavourId: owner,
            kind: "thread_mapping",
            subjectType: "thread",
            subjectId: threadId,
            payload: {
              from: from ?? "unknown sender",
              subject,
              preview: body.slice(0, 400),
              // Says what the guess was, so confirming it is one click rather than a search.
              ...(attribution.reason === "domain" ? { guessedBy: "domain", guessedProspectId: attribution.prospectId } : {}),
            },
          });
        } else {
          result.unattributed += 1;
        }
      }
    } else {
      await db.update(threads).set({ unread: true, lastActivityAt: receivedAt(message) }).where(eq(threads.id, threadId));
    }

    await db.insert(messages).values({
      id: newId("message"),
      threadId,
      endeavourId,
      prospectId,
      direction: "inbound",
      externalMessageId: id,
      subject,
      body,
      // Null when nothing matched: "we do not know" is a different fact from "by thread".
      ...(attribution.reason === "none" ? {} : { attributedBy: attribution.reason }),
      receivedAt: receivedAt(message),
    });
    result.stored += 1;

    if (prospectId) {
      result.matched += 1;
      const [prospect] = await db.select().from(prospects).where(eq(prospects.id, prospectId));
      if (prospect && prospect.stage !== "replied") {
        try {
          assertTransition(prospect.stage, "replied", "system");
          await db
            .update(prospects)
            .set({ stage: "replied", nextAction: "Reply received: decide the response", nextActionAt: now })
            .where(eq(prospects.id, prospect.id));
        } catch {
          // Further along already: the reply is recorded without moving the stage back.
        }
      }
      await recordEvent(db, {
        eventType: "message.received",
        entityType: "message",
        entityId: id,
        endeavourId,
        subject,
        detail: `reply from ${from ?? "unknown sender"}`,
      });
    }
  }

  if (gmail.tokensChanged) {
    await db.update(mailboxes).set({ tokenCiphertext: sealJson(gmail.currentTokens, deps.tokenKey) }).where(eq(mailboxes.id, mailbox.id));
  }
  return result;
}
