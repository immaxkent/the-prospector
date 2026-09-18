/**
 * Revising an endeavour after it is running. Every revision is a new spec version with a
 * reason: the old one is kept, never overwritten, so a change in strategy can be traced to
 * the results that followed it (handoff §2, §14).
 */
import { and, eq, inArray } from "drizzle-orm";
import type { Database } from "../db/client";
import { endeavourSpecVersions, endeavours, offers, segments } from "../db/schema";
import {
  endeavourSpecSchema,
  evaluateActivation,
  type EndeavourSpec,
  type FieldState,
} from "../domain/endeavour-spec";
import { mailboxes } from "../db/schema";
import { newId } from "../ids";
import { conflict, invalid, notFound } from "./errors";
import { recordEvent, type Executor } from "./events";

const confirmed = <T>(f: FieldState<T>) => (f.state === "stated" || f.state === "confirmed" ? f.value : undefined);

/** Which fields changed, for the version history and the event. */
export function changedFields(before: EndeavourSpec, after: EndeavourSpec) {
  const keys = Object.keys(before) as (keyof EndeavourSpec)[];
  return keys.filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key])).map(String);
}

/** Segments follow the spec: new buyers are added, ones dropped from the spec are retired. */
async function syncSegments(tx: Executor, endeavourId: string, spec: EndeavourSpec, version: number) {
  const buyers = confirmed(spec.buyers) ?? [];
  const existing = await tx.select().from(segments).where(eq(segments.endeavourId, endeavourId));
  const wanted = new Set(buyers.map((b) => b.name));

  for (const buyer of buyers) {
    const match = existing.find((s) => s.name === buyer.name);
    if (match) {
      await tx
        .update(segments)
        .set({
          definition: buyer.definition,
          signals: buyer.signals,
          painHypothesis: buyer.painHypothesis,
          priority: buyer.priority,
          specVersion: version,
          status: "active",
        })
        .where(eq(segments.id, match.id));
    } else {
      await tx.insert(segments).values({
        id: newId("segment"),
        endeavourId,
        name: buyer.name,
        definition: buyer.definition,
        signals: buyer.signals,
        painHypothesis: buyer.painHypothesis,
        priority: buyer.priority,
        specVersion: version,
      });
    }
  }
  // Prospects already found keep their segment; it is retired, not deleted.
  const retired = existing.filter((s) => !wanted.has(s.name) && s.status === "active").map((s) => s.id);
  if (retired.length) await tx.update(segments).set({ status: "retired" }).where(inArray(segments.id, retired));
  return { active: buyers.length, retired: retired.length };
}

async function syncOffer(tx: Executor, endeavourId: string, spec: EndeavourSpec, version: number) {
  const offering = confirmed(spec.offering);
  if (!offering) return;
  const name = offering.summary.slice(0, 120);
  const proposition = [offering.summary, ...offering.deliverables].join(" · ");
  const pricing = confirmed(spec.pricing) ?? null;
  const [existing] = await tx
    .select()
    .from(offers)
    .where(and(eq(offers.endeavourId, endeavourId), eq(offers.status, "active")));
  if (existing) {
    await tx.update(offers).set({ name, proposition, pricing, specVersion: version }).where(eq(offers.id, existing.id));
  } else {
    await tx.insert(offers).values({ id: newId("offer"), endeavourId, name, proposition, pricing, specVersion: version });
  }
}

export interface ReviseInput {
  endeavourId: string;
  spec: EndeavourSpec;
  /** Why the strategy changed: stored with the version. */
  reason: string;
}

export async function reviseEndeavourSpec(db: Database, input: ReviseInput, now = new Date()) {
  const reason = input.reason.trim();
  if (!reason) throw invalid("say why the strategy is changing");
  const parsed = endeavourSpecSchema.safeParse(input.spec);
  if (!parsed.success) throw invalid("the revised spec is not valid");
  const spec = parsed.data;

  return db.transaction(async (tx) => {
    const [endeavour] = await tx.select().from(endeavours).where(eq(endeavours.id, input.endeavourId)).for("update");
    if (!endeavour) throw notFound("endeavour");
    if (endeavour.status === "archived") throw conflict("an archived endeavour cannot be revised");

    const connected = await tx.select({ id: mailboxes.id }).from(mailboxes).where(eq(mailboxes.status, "connected"));
    const gate = evaluateActivation(spec, {
      brief: endeavour.brief,
      connectedMailboxIds: connected.map((m) => m.id),
    });
    if (!gate.ready) throw conflict(gate.blockers.map((b) => b.message).join("; "));

    const changed = changedFields(endeavour.spec, spec);
    if (changed.length === 0) throw conflict("nothing changed in this revision");

    const version = endeavour.specVersion + 1;
    await tx
      .update(endeavours)
      .set({
        spec,
        specVersion: version,
        name: spec.name,
        kind: spec.kind,
        autonomyLevel: spec.autonomyLevel,
        mailboxId: confirmed(spec.mailboxId) ?? endeavour.mailboxId,
      })
      .where(eq(endeavours.id, endeavour.id));
    await tx.insert(endeavourSpecVersions).values({
      id: newId("specVersion"),
      endeavourId: endeavour.id,
      version,
      spec,
      brief: endeavour.brief,
      reason,
    });

    const segmentChange = await syncSegments(tx, endeavour.id, spec, version);
    await syncOffer(tx, endeavour.id, spec, version);

    await recordEvent(tx, {
      eventType: "endeavour.spec_revised",
      entityType: "endeavour",
      entityId: endeavour.id,
      endeavourId: endeavour.id,
      subject: spec.name,
      detail: `v${version}: ${changed.join(", ")} — ${reason}`,
      data: { version, changed, ...segmentChange },
    });
    return { version, changed, ...segmentChange };
  }, { isolationLevel: "read committed" });
}

/** Every version of the strategy, newest first. */
export async function specHistory(db: Database, endeavourId: string) {
  return db
    .select()
    .from(endeavourSpecVersions)
    .where(eq(endeavourSpecVersions.endeavourId, endeavourId))
    .orderBy(endeavourSpecVersions.version);
}
