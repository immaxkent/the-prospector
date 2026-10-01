/**
 * Reading the database for what the reports say.
 *
 * Kept apart from the builders so the wording is testable without a database and the
 * queries are testable without wording. Everything here is a count of something that
 * already happened; nothing is inferred and nothing is written.
 */
import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import type { Database } from "../db/client";
import { endeavours, events, messages, prospects, threads } from "../db/schema";
import { normaliseSettings } from "../domain/endeavour-settings";
import { countProspecting, haltNotice, prospectingHalt } from "../domain/prospecting";
import type { DigestInput } from "./digest";

export const DIGEST_SENT = "report.digest_sent";
export const REVIEW_SENT = "report.review_sent";

/** When a report of this kind last went out for this endeavour, or null if never. */
export async function lastSentAt(db: Database, endeavourId: string, eventType: string): Promise<Date | null> {
  const rows = await db
    .select({ at: events.occurredAt, payload: events.payload })
    .from(events)
    .where(eq(events.eventType, eventType))
    .orderBy(desc(events.occurredAt))
    .limit(50);
  // Filtered here rather than in SQL: endeavourId lives inside the payload, and fifty rows
  // is already far more history than "when was the last one" needs.
  return rows.find((r) => r.payload["endeavourId"] === endeavourId)?.at ?? null;
}

/**
 * Threads where the newest message is theirs.
 *
 * This is the state the operator most needs to see and the one nothing else reports: they
 * answered, and nobody has answered back. It is not pending — the prospect is not waiting
 * to be found — and it is not comfortably active either.
 */
export async function waitingOnYou(db: Database, endeavourId: string, now: Date) {
  const own = await db.select({ id: threads.id }).from(threads).where(eq(threads.endeavourId, endeavourId));
  if (own.length === 0) return { count: 0, longestDays: 0 };

  const rows = await db
    .select({ threadId: messages.threadId, direction: messages.direction, at: messages.sentAt, created: messages.createdAt })
    .from(messages)
    .where(inArray(messages.threadId, own.map((t) => t.id)));

  const newest = new Map<string, { direction: string; at: Date }>();
  for (const row of rows) {
    const at = row.at ?? row.created;
    const current = newest.get(row.threadId);
    if (!current || at.getTime() > current.at.getTime()) newest.set(row.threadId, { direction: row.direction, at });
  }

  const waiting = [...newest.values()].filter((m) => m.direction === "inbound");
  const oldest = waiting.reduce<number>((max, m) => Math.max(max, now.getTime() - m.at.getTime()), 0);
  return { count: waiting.length, longestDays: Math.floor(oldest / 86_400_000) };
}

/** Prospects the operator released whose approved message never left the building. */
export async function stuckSends(db: Database, endeavourId: string) {
  const rows = await db
    .select({ id: messages.id })
    .from(messages)
    .innerJoin(prospects, eq(messages.prospectId, prospects.id))
    .where(
      and(
        eq(messages.endeavourId, endeavourId),
        eq(messages.direction, "outbound"),
        eq(messages.sendState, "failed"),
        isNotNull(prospects.releasedAt),
      ),
    );
  return rows.length;
}

export interface DigestFacts extends DigestInput {}

export async function collectDigest(
  db: Database,
  endeavourId: string,
  now: Date,
  opts: { budgetExhausted: boolean },
): Promise<DigestFacts | null> {
  const [endeavour] = await db.select().from(endeavours).where(eq(endeavours.id, endeavourId));
  if (!endeavour) return null;

  const rows = await db
    .select({ stage: prospects.stage, reviewStatus: prospects.reviewStatus, segmentId: prospects.segmentId })
    .from(prospects)
    .where(eq(prospects.endeavourId, endeavourId));

  const settings = normaliseSettings(endeavour.settings).prospecting;
  const count = countProspecting(rows);
  const halt = prospectingHalt(count, settings);
  const waiting = await waitingOnYou(db, endeavourId, now);

  return {
    endeavourId,
    endeavourName: endeavour.name,
    waitingOnYou: waiting.count,
    waitingLongestDays: waiting.longestDays,
    stuckSends: await stuckSends(db, endeavourId),
    // The same words the run log uses, from the same function: an operator reading both
    // should not have to work out whether it is the same stall.
    haltNotice: halt === null ? null : haltNotice(halt, count, settings),
    budgetExhausted: opts.budgetExhausted,
  };
}
