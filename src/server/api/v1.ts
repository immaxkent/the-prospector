/**
 * Versioned JSON API for other systems (handoff §9). Reads are summaries, not raw rows;
 * writes are limited to events and signals. Auth is an API key today; the check sits in one
 * place so sessions or OAuth can replace it without touching the handlers.
 */
import { timingSafeEqual } from "node:crypto";
import { and, asc, desc, eq, gt, inArray, or, sql } from "drizzle-orm";
import { z } from "zod/v4";
import type { AppConfig } from "../config";
import type { Database } from "../db/client";
import { companies, endeavours, events, insights, people, prospects } from "../db/schema";
import { newId } from "../ids";
import { recordEvent } from "../commands/events";

export const API_SCHEMA_VERSION = 1;

/** Events other systems may send us, and the ones we publish (handoff §9). */
export const CANONICAL_EVENT_TYPES = [
  "product.milestone.completed",
  "product.capability.changed",
  "commercial.signal.detected",
  "commercial.opportunity.created",
  "commercial.opportunity.updated",
  "commercial.commitment.made",
] as const;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body, null, 2), { status, headers: { "content-type": "application/json; charset=utf-8" } });

const error = (status: number, message: string) => json({ error: message }, status);

function keyMatches(given: string, allowed: readonly string[]) {
  const candidate = Buffer.from(given);
  return allowed.some((key) => {
    const expected = Buffer.from(key);
    return expected.length === candidate.length && timingSafeEqual(expected, candidate);
  });
}

/** Bearer token or X-API-Key; returns a response when the caller may not proceed. */
export function checkApiKey(request: Request, config: AppConfig) {
  if (config.mode !== "live") return error(503, "the API is unavailable in demo mode");
  if (config.apiKeys.length === 0) return error(503, "no API keys are configured on this server");
  const header = request.headers.get("authorization");
  const given = header?.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : request.headers.get("x-api-key")?.trim();
  if (!given) return error(401, "provide an API key as a bearer token or X-API-Key header");
  if (!keyMatches(given, config.apiKeys)) return error(403, "that API key is not valid");
  return null;
}

export interface ApiDeps {
  db: Database;
  config: AppConfig;
}

const summaryOf = (e: typeof endeavours.$inferSelect) => ({
  id: e.id,
  name: e.name,
  kind: e.kind,
  status: e.status,
  autonomyLevel: e.autonomyLevel,
  objective: e.spec.objective.state === "missing" ? null : (e.spec.objective as { value?: unknown }).value ?? null,
  activatedAt: e.activatedAt?.toISOString() ?? null,
  updatedAt: e.updatedAt.toISOString(),
});

export async function listEndeavours(deps: ApiDeps) {
  const rows = await deps.db.select().from(endeavours).orderBy(asc(endeavours.createdAt));
  return json({ schemaVersion: API_SCHEMA_VERSION, endeavours: rows.map(summaryOf) });
}

export async function endeavourSummary(deps: ApiDeps, id: string) {
  const [endeavour] = await deps.db.select().from(endeavours).where(eq(endeavours.id, id));
  if (!endeavour) return error(404, "no endeavour with that id");
  const own = await deps.db.select().from(prospects).where(eq(prospects.endeavourId, id));
  const active = own.filter((p) => p.reviewStatus !== "rejected");
  const byStage: Record<string, number> = {};
  for (const prospect of active) byStage[prospect.stage] = (byStage[prospect.stage] ?? 0) + 1;
  return json({
    schemaVersion: API_SCHEMA_VERSION,
    endeavour: summaryOf(endeavour),
    prospects: { total: active.length, rejected: own.length - active.length, byStage },
  });
}

export async function endeavourProspects(deps: ApiDeps, id: string, limit = 100) {
  const [endeavour] = await deps.db.select({ id: endeavours.id }).from(endeavours).where(eq(endeavours.id, id));
  if (!endeavour) return error(404, "no endeavour with that id");
  const rows = await deps.db
    .select()
    .from(prospects)
    .where(eq(prospects.endeavourId, id))
    .orderBy(desc(prospects.qualificationScore))
    .limit(Math.min(limit, 500));
  const companyIds = rows.map((r) => r.companyId).filter((x): x is string => !!x);
  const personIds = rows.map((r) => r.personId).filter((x): x is string => !!x);
  const [companyRows, personRows] = await Promise.all([
    companyIds.length ? deps.db.select().from(companies).where(inArray(companies.id, companyIds)) : [],
    personIds.length ? deps.db.select().from(people).where(inArray(people.id, personIds)) : [],
  ]);
  const companyById = new Map(companyRows.map((c) => [c.id, c]));
  const personById = new Map(personRows.map((p) => [p.id, p]));

  return json({
    schemaVersion: API_SCHEMA_VERSION,
    prospects: rows.map((p) => ({
      id: p.id,
      company: p.companyId ? (companyById.get(p.companyId)?.name ?? null) : null,
      person: p.personId ? (personById.get(p.personId)?.name ?? null) : null,
      stage: p.stage,
      reviewStatus: p.reviewStatus,
      score: p.qualificationScore,
      // Contact details stay in the app: the API reports state, not an address book.
      nextAction: p.nextAction,
      updatedAt: p.updatedAt.toISOString(),
    })),
  });
}

export async function endeavourInsights(deps: ApiDeps, id: string) {
  const rows = await deps.db
    .select()
    .from(insights)
    .where(and(eq(insights.endeavourId, id), eq(insights.status, "open")))
    .orderBy(desc(insights.createdAt));
  return json({
    schemaVersion: API_SCHEMA_VERSION,
    insights: rows.map((i) => ({
      id: i.id,
      type: i.type,
      statement: i.statement,
      evidence: i.evidence,
      confidence: i.confidence,
      createdAt: i.createdAt.toISOString(),
    })),
  });
}

/** Events after a cursor, oldest first, so a consumer can catch up without missing any. */
export async function endeavourEvents(deps: ApiDeps, id: string, since: number, limit = 100) {
  const rows = await deps.db
    .select()
    .from(events)
    .where(and(gt(events.seq, since), or(eq(events.entityId, id), sql`${events.payload} ->> 'endeavourId' = ${id}`)))
    .orderBy(asc(events.seq))
    .limit(Math.min(limit, 500));
  return json({
    schemaVersion: API_SCHEMA_VERSION,
    cursor: rows.at(-1)?.seq ?? since,
    events: rows.map((e) => ({
      seq: e.seq,
      type: e.eventType,
      entityType: e.entityType,
      entityId: e.entityId,
      payload: e.payload,
      occurredAt: e.occurredAt.toISOString(),
    })),
  });
}

export const inboundEventSchema = z.object({
  type: z.string().trim().min(1).max(120),
  entityType: z.string().trim().min(1).max(60).default("external"),
  entityId: z.string().trim().min(1).max(120),
  endeavourId: z.string().trim().max(64).optional(),
  payload: z.record(z.string(), z.unknown()).default({}),
  occurredAt: z.iso.datetime().optional(),
});

/** Anything another system tells us. Stored verbatim; nothing acts on it automatically. */
export async function receiveEvent(deps: ApiDeps, body: unknown) {
  const parsed = inboundEventSchema.safeParse(body);
  if (!parsed.success) return error(400, z.prettifyError(parsed.error));
  const event = parsed.data;
  await deps.db.insert(events).values({
    id: newId("event"),
    sourceSystem: "external",
    eventType: event.type,
    entityType: event.entityType,
    entityId: event.entityId,
    payload: { ...event.payload, ...(event.endeavourId ? { endeavourId: event.endeavourId } : {}) },
    ...(event.occurredAt ? { occurredAt: new Date(event.occurredAt) } : {}),
  });
  return json({ accepted: true, canonical: (CANONICAL_EVENT_TYPES as readonly string[]).includes(event.type) }, 202);
}

/** Prospects from another system or a list. Same checks as research: nothing bypasses them. */
export async function receiveImport(deps: ApiDeps, body: unknown) {
  const { importProspects } = await import("../commands/import");
  const { CommandError } = await import("../commands/errors");
  try {
    const result = await importProspects(deps.db, body as never);
    return json({ accepted: true, ...result }, 202);
  } catch (err) {
    if (err instanceof CommandError) return error(err.code === "not_found" ? 404 : 400, err.message);
    throw err;
  }
}

export const signalSchema = z.object({
  endeavourId: z.string().trim().min(1).max(64),
  statement: z.string().trim().min(1).max(500),
  evidence: z.record(z.string(), z.unknown()).default({}),
  confidence: z.number().min(0).max(1).default(0.5),
});

/** A commercial signal from outside, recorded as an insight for the operator to judge. */
export async function receiveSignal(deps: ApiDeps, body: unknown) {
  const parsed = signalSchema.safeParse(body);
  if (!parsed.success) return error(400, z.prettifyError(parsed.error));
  const signal = parsed.data;
  const [endeavour] = await deps.db.select({ id: endeavours.id }).from(endeavours).where(eq(endeavours.id, signal.endeavourId));
  if (!endeavour) return error(404, "no endeavour with that id");

  const id = newId("insight");
  await deps.db.insert(insights).values({
    id,
    endeavourId: signal.endeavourId,
    type: "signal",
    statement: signal.statement,
    evidence: { ...signal.evidence, source: "external" },
    confidence: signal.confidence,
  });
  await recordEvent(deps.db, {
    eventType: "commercial.signal.detected",
    entityType: "endeavour",
    entityId: signal.endeavourId,
    endeavourId: signal.endeavourId,
    detail: signal.statement,
    data: { source: "external" },
  });
  return json({ accepted: true, insightId: id }, 202);
}
