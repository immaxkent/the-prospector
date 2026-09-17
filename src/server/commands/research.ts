/**
 * Storing research results. Suppressed contacts are never stored, existing targets are
 * matched rather than duplicated, and every prospect keeps the evidence it was found by.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Database } from "../db/client";
import { companies, evidence, people, prospects, suppressions, triggers } from "../db/schema";
import type { ScoreFactor } from "../db/schema";
import type { Candidate } from "../agent/research";
import { newId } from "../ids";
import { notFound } from "./errors";
import { recordEvent, type Executor } from "./events";

export interface StoreResult {
  created: string[];
  suppressed: number;
  duplicates: number;
}

const domainOf = (email: string) => email.slice(email.lastIndexOf("@") + 1).toLowerCase();

async function isSuppressed(tx: Executor, candidate: Candidate) {
  const email = candidate.person?.email?.toLowerCase();
  const values = [email, email ? domainOf(email) : undefined, candidate.company.domain?.toLowerCase()].filter(
    (v): v is string => !!v,
  );
  if (values.length === 0) return false;
  const rows = await tx.select({ id: suppressions.id }).from(suppressions).where(inArray(suppressions.value, values));
  return rows.length > 0;
}

/** Matches an existing company by domain, else by name, so research does not fork records. */
async function upsertCompany(tx: Executor, candidate: Candidate) {
  const domain = candidate.company.domain?.toLowerCase() ?? null;
  const [byDomain] = domain ? await tx.select().from(companies).where(eq(companies.domain, domain)) : [];
  const [byName] = byDomain ? [byDomain] : await tx.select().from(companies).where(eq(companies.name, candidate.company.name));
  if (byName) return byName.id;
  const id = newId("company");
  await tx.insert(companies).values({
    id,
    name: candidate.company.name,
    domain,
    description: candidate.company.description ?? null,
  });
  return id;
}

async function upsertPerson(tx: Executor, companyId: string, candidate: Candidate) {
  const person = candidate.person;
  if (!person) return null;
  const email = person.email?.toLowerCase() ?? null;
  const [existing] = email
    ? await tx.select().from(people).where(eq(people.email, email))
    : await tx.select().from(people).where(and(eq(people.companyId, companyId), eq(people.name, person.name)));
  if (existing) return existing.id;
  const id = newId("person");
  await tx.insert(people).values({
    id,
    companyId,
    name: person.name,
    role: person.role ?? null,
    email,
    linkedinUrl: person.linkedinUrl ?? null,
  });
  return id;
}

export interface StoreInput {
  endeavourId: string;
  segmentId: string | null;
  candidates: readonly Candidate[];
  runId?: string | null;
  source?: string;
}

export async function storeCandidates(db: Database, input: StoreInput): Promise<StoreResult> {
  const result: StoreResult = { created: [], suppressed: 0, duplicates: 0 };

  for (const candidate of input.candidates) {
    await db.transaction(async (tx) => {
      if (await isSuppressed(tx, candidate)) {
        result.suppressed += 1;
        return;
      }
      const companyId = await upsertCompany(tx, candidate);
      const personId = await upsertPerson(tx, companyId, candidate);

      const [duplicate] = await tx
        .select({ id: prospects.id })
        .from(prospects)
        .where(
          and(
            eq(prospects.endeavourId, input.endeavourId),
            personId ? eq(prospects.personId, personId) : eq(prospects.companyId, companyId),
          ),
        );
      if (duplicate) {
        result.duplicates += 1;
        return;
      }

      const prospectId = newId("prospect");
      await tx.insert(prospects).values({
        id: prospectId,
        endeavourId: input.endeavourId,
        companyId,
        personId,
        segmentId: input.segmentId,
        stage: "researched",
        reviewStatus: "researching",
        source: input.source ?? "web_research",
      });
      const evidenceIds: string[] = [];
      for (const claim of candidate.evidence) {
        const id = newId("evidence");
        evidenceIds.push(id);
        await tx.insert(evidence).values({
          id,
          entityType: "prospect",
          entityId: prospectId,
          sourceType: "web",
          sourceRef: claim.sourceRef,
          excerpt: claim.excerpt,
          claim: claim.claim,
          confidence: claim.confidence,
          runId: input.runId ?? null,
        });
      }
      await tx.insert(triggers).values({
        id: newId("trigger"),
        prospectId,
        type: candidate.trigger.type,
        description: candidate.trigger.description,
        evidenceId: evidenceIds[0] ?? null,
      });
      await recordEvent(tx, {
        eventType: "prospect.researched",
        entityType: "prospect",
        entityId: prospectId,
        endeavourId: input.endeavourId,
        subject: candidate.company.name,
        detail: candidate.trigger.description,
      });
      result.created.push(prospectId);
    });
  }
  return result;
}

/** Names already targeted by this endeavour, so research does not look for them again. */
export async function knownTargetNames(db: Database, endeavourId: string, limit = 200) {
  const rows = await db
    .select({ name: companies.name })
    .from(prospects)
    .innerJoin(companies, eq(companies.id, prospects.companyId))
    .where(eq(prospects.endeavourId, endeavourId))
    .orderBy(sql`${prospects.createdAt} desc`)
    .limit(limit);
  return rows.map((r) => r.name);
}

export interface QualificationUpdate {
  prospectId: string;
  score: number;
  factors: ScoreFactor[];
  reason: string;
  outcome: "qualified" | "needs_review" | "rejected";
}

/** Writes a qualification result: the score, its factors and the outcome, with the reason kept. */
export async function applyQualification(db: Database, input: QualificationUpdate) {
  return db.transaction(async (tx) => {
    const [prospect] = await tx.select().from(prospects).where(eq(prospects.id, input.prospectId)).for("update");
    if (!prospect) throw notFound("prospect");

    const qualified = input.outcome === "qualified";
    await tx
      .update(prospects)
      .set({
        qualificationScore: input.score,
        scoreFactors: input.factors,
        scoreReason: input.reason,
        reviewStatus: input.outcome,
        ...(qualified ? { stage: "qualified", nextAction: "First outreach due", nextActionAt: new Date() } : {}),
        ...(input.outcome === "rejected" ? { rejectionReason: input.reason, nextAction: null, nextActionAt: null } : {}),
      })
      .where(eq(prospects.id, prospect.id));

    await recordEvent(tx, {
      eventType: qualified ? "prospect.qualified" : input.outcome === "rejected" ? "prospect.rejected" : "prospect.needs_review",
      entityType: "prospect",
      entityId: prospect.id,
      endeavourId: prospect.endeavourId,
      detail: `${input.score}/100 · ${input.reason}`,
    });
  });
}
