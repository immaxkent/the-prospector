/**
 * Reading the database for what the reports say.
 *
 * Kept apart from the builders so the wording is testable without a database and the
 * queries are testable without wording. Everything here is a count of something that
 * already happened; nothing is inferred and nothing is written.
 */
import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import type { Database } from "../db/client";
import { companies, endeavours, events, interactions, messages, prospects, segments, threads } from "../db/schema";
import { normaliseSettings } from "../domain/endeavour-settings";
import { countProspecting, haltNotice, prospectingHalt } from "../domain/prospecting";
import { allocate } from "../domain/allocation";
import { RATE_MIN_SAMPLE } from "../domain/workload";
import type { DigestInput } from "./digest";
import type { ReviewFacts } from "./review";

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

/* ---------- the weekly review ---------- */

/**
 * How long something has to be quiet before the review asks about it.
 *
 * Not a lapse: nothing is moved, and the prospect keeps its place in the buffer. This is
 * only the point at which the system stops assuming no news is good news and puts the
 * question to the operator, who is the only one who can answer it.
 */
export const SILENT_AFTER_DAYS = 14;

const wholeDays = (from: Date, now: Date) => Math.floor((now.getTime() - from.getTime()) / 86_400_000);

export async function collectReview(db: Database, endeavourId: string, now: Date): Promise<ReviewFacts | null> {
  const [endeavour] = await db.select().from(endeavours).where(eq(endeavours.id, endeavourId));
  if (!endeavour) return null;

  const prospectRows = await db
    .select({
      id: prospects.id,
      stage: prospects.stage,
      reviewStatus: prospects.reviewStatus,
      segmentId: prospects.segmentId,
      releasedAt: prospects.releasedAt,
      createdAt: prospects.createdAt,
      company: companies.name,
    })
    .from(prospects)
    .leftJoin(companies, eq(prospects.companyId, companies.id))
    .where(eq(prospects.endeavourId, endeavourId));

  const named = new Map(prospectRows.map((p) => [p.id, p.company ?? "Unnamed company"]));
  const messageRows = await db
    .select({
      prospectId: messages.prospectId,
      direction: messages.direction,
      sendState: messages.sendState,
      at: messages.sentAt,
      created: messages.createdAt,
    })
    .from(messages)
    .where(eq(messages.endeavourId, endeavourId));

  /** The newest message on each prospect, whichever way it went. */
  const latest = new Map<string, { direction: string; at: Date }>();
  for (const row of messageRows) {
    if (!row.prospectId) continue;
    const at = row.at ?? row.created;
    const current = latest.get(row.prospectId);
    if (!current || at.getTime() > current.at.getTime()) latest.set(row.prospectId, { direction: row.direction, at });
  }

  const interactionRows = await db
    .select({ prospectId: interactions.prospectId, at: interactions.occurredAt })
    .from(interactions)
    .where(eq(interactions.endeavourId, endeavourId));
  const lastInteraction = new Map<string, Date>();
  for (const row of interactionRows) {
    const current = lastInteraction.get(row.prospectId);
    if (!current || row.at.getTime() > current.getTime()) lastInteraction.set(row.prospectId, row.at);
  }

  const live = prospectRows.filter((p) => p.reviewStatus !== "rejected" && !["won", "lost", "nurture"].includes(p.stage));
  const item = (id: string, days: number) => ({ prospectId: id, company: named.get(id) ?? "Unnamed company", days });

  const followUp = live
    .filter((p) => latest.get(p.id)?.direction === "inbound")
    .map((p) => item(p.id, wholeDays(latest.get(p.id)!.at, now)));

  // Found, and nobody has decided yet. Nothing is written until the operator releases it,
  // so these are the ones the system is actually waiting on.
  const decide = live
    .filter((p) => !p.releasedAt && ["discovered", "researched", "qualified"].includes(p.stage))
    .map((p) => item(p.id, wholeDays(p.createdAt, now)));

  const silent = live
    .filter((p) => {
      const last = latest.get(p.id);
      return last?.direction === "outbound" && wholeDays(last.at, now) >= SILENT_AFTER_DAYS;
    })
    .map((p) => item(p.id, wholeDays(latest.get(p.id)!.at, now)));

  // A conversation that only ever happened elsewhere: no mailbox trail, and nothing logged
  // for a fortnight. The system cannot tell whether it is alive, and should say so rather
  // than guess either way.
  const offChannel = live
    .filter((p) => {
      const logged = lastInteraction.get(p.id);
      return !!logged && !latest.get(p.id) && wholeDays(logged, now) >= SILENT_AFTER_DAYS;
    })
    .map((p) => item(p.id, wholeDays(lastInteraction.get(p.id)!, now)));

  const settings = normaliseSettings(endeavour.settings).prospecting;
  const count = countProspecting(prospectRows);
  const liveSegments = await db
    .select()
    .from(segments)
    .where(and(eq(segments.endeavourId, endeavourId), eq(segments.status, "active")));
  const shares = new Map(
    allocate(
      liveSegments.map((s) => ({ id: s.id, priority: s.priority, pinned: s.pinnedShare })),
      settings.maximumPending,
      count.pendingBySegment,
    ).map((a) => [a.segmentId, a.share]),
  );

  const segmentOf = new Map(prospectRows.map((p) => [p.id, p.segmentId]));
  const sentBySegment = new Map<string, number>();
  const repliedProspects = new Set<string>();
  for (const row of messageRows) {
    if (!row.prospectId) continue;
    const segmentId = segmentOf.get(row.prospectId);
    if (!segmentId) continue;
    if (row.direction === "outbound" && row.sendState === "sent") {
      sentBySegment.set(segmentId, (sentBySegment.get(segmentId) ?? 0) + 1);
    }
    if (row.direction === "inbound") repliedProspects.add(row.prospectId);
  }
  const repliesBySegment = new Map<string, number>();
  for (const id of repliedProspects) {
    const segmentId = segmentOf.get(id);
    if (segmentId) repliesBySegment.set(segmentId, (repliesBySegment.get(segmentId) ?? 0) + 1);
  }

  return {
    endeavourId,
    endeavourName: endeavour.name,
    followUp,
    decide,
    silent,
    offChannel,
    segments: liveSegments
      .slice()
      .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id))
      .map((s) => ({
        name: s.name,
        pending: count.pendingBySegment.get(s.id) ?? 0,
        share: shares.get(s.id) ?? 0,
        sent: sentBySegment.get(s.id) ?? 0,
        replies: repliesBySegment.get(s.id) ?? 0,
      })),
    pending: count.pending,
    pendingCap: settings.maximumPending,
    active: count.active,
    activeGoal: settings.activeGoal,
    minSample: RATE_MIN_SAMPLE,
  };
}
