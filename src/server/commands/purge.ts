/**
 * Deleting an endeavour and everything it brought with it.
 *
 * Archiving hides an endeavour and freezes it; the rows stay, which is right for one with
 * real history you may want to read later. Starting again is a different thing: the
 * prospects, threads, approvals and messages of an abandoned attempt distort every count
 * and chart that follows it, and there is no honest way to read a funnel that still has
 * last week's rejections in it.
 *
 * Most of the schema cascades from the endeavour. Three things do not, and would be left
 * behind as litter:
 *
 *   - companies and their people, which belong to no endeavour because two endeavours may
 *     legitimately target the same company
 *   - evidence, which addresses its subject by id with no foreign key to enforce it
 *   - the intake session that produced the endeavour, whose link is set null on delete
 *
 * So those are handled explicitly, and companies are only removed when no other
 * endeavour's prospects still point at them.
 */
import { and, eq, inArray, isNull, notInArray, sql } from "drizzle-orm";
import type { Database } from "../db/client";
import { companies, endeavours, evidence, intakeSessions, prospects } from "../db/schema";
import { conflict, invalid, notFound } from "./errors";

export interface PurgeSummary {
  endeavour: string;
  prospects: number;
  companies: number;
  evidence: number;
  intakes: number;
}

/**
 * Permanently removes an endeavour.
 *
 * The name must be typed back. This cannot be undone and there is no backup to restore
 * from, so a misfired click should not be enough — the same reason the archive button asks
 * first, held to a higher standard because this one destroys.
 */
export async function purgeEndeavour(
  db: Database,
  input: { endeavourId: string; confirmName: string },
): Promise<PurgeSummary> {
  return db.transaction(async (tx) => {
    const [endeavour] = await tx.select().from(endeavours).where(eq(endeavours.id, input.endeavourId));
    if (!endeavour) throw notFound("endeavour");

    if (input.confirmName.trim().toLowerCase() !== endeavour.name.trim().toLowerCase()) {
      throw invalid(`type the endeavour's name exactly to delete it: ${endeavour.name}`);
    }
    if (endeavour.status === "active") {
      // Pausing first is one deliberate act before another. An active endeavour is one the
      // worker may be running this minute.
      throw conflict("pause or archive this endeavour before deleting it");
    }

    // Collected before the delete, because afterwards there is nothing left to ask.
    const mine = await tx
      .select({ id: prospects.id, companyId: prospects.companyId })
      .from(prospects)
      .where(eq(prospects.endeavourId, input.endeavourId));
    const companyIds = [...new Set(mine.map((p) => p.companyId).filter((id): id is string => !!id))];
    const subjectIds = [...new Set([...mine.map((p) => p.id), ...companyIds, input.endeavourId])];

    // The endeavour goes, and with it everything the schema cascades: prospects, segments,
    // offers, threads, messages, approvals, runs, notifications, spec versions.
    await tx.delete(endeavours).where(eq(endeavours.id, input.endeavourId));

    // Companies belong to no endeavour, so one is only litter if nothing else points at it.
    // People and their triggers cascade from the company.
    let removedCompanies = 0;
    if (companyIds.length > 0) {
      const stillUsed = await tx
        .select({ id: prospects.companyId })
        .from(prospects)
        .where(inArray(prospects.companyId, companyIds));
      const keep = new Set(stillUsed.map((r) => r.id).filter((id): id is string => !!id));
      const orphaned = companyIds.filter((id) => !keep.has(id));
      if (orphaned.length > 0) {
        const gone = await tx.delete(companies).where(inArray(companies.id, orphaned)).returning({ id: companies.id });
        removedCompanies = gone.length;
      }
    }

    // Evidence addresses its subject by id with no foreign key, so nothing removed it.
    let removedEvidence = 0;
    if (subjectIds.length > 0) {
      const gone = await tx.delete(evidence).where(inArray(evidence.entityId, subjectIds)).returning({ id: evidence.id });
      removedEvidence = gone.length;
    }

    // The intake that produced this endeavour had its link set to null by the delete, which
    // leaves a finished interview pointing at nothing. Those are removed too; an intake
    // still in progress belongs to nobody and is left alone.
    const goneIntakes = await tx
      .delete(intakeSessions)
      .where(and(eq(intakeSessions.status, "activated"), isNull(intakeSessions.endeavourId)))
      .returning({ id: intakeSessions.id });

    return {
      endeavour: endeavour.name,
      prospects: mine.length,
      companies: removedCompanies,
      evidence: removedEvidence,
      intakes: goneIntakes.length,
    };
  });
}

/**
 * Companies nothing points at any more, from whatever cause.
 *
 * Research creates a company before it knows whether the prospect survives qualification,
 * so a rejected candidate can leave one behind without any endeavour being deleted.
 */
export async function orphanedCompanyCount(db: Database): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(companies)
    .where(
      notInArray(
        companies.id,
        db.select({ id: sql<string>`coalesce(${prospects.companyId}, '')` }).from(prospects),
      ),
    );
  return Number(row?.n ?? 0);
}
