/**
 * Export. JSON is the whole record for backup; CSV is one table for a spreadsheet.
 * Both read the database directly so an export always matches what the app shows.
 */
import { asc, eq, inArray } from "drizzle-orm";
import type { Database } from "../db/client";
import { companies, endeavours, evidence, insights, messages, opportunities, people, prospects, segments } from "../db/schema";

export const EXPORT_TABLES = ["prospects", "messages", "opportunities", "insights"] as const;
export type ExportTable = (typeof EXPORT_TABLES)[number];

/** RFC 4180: quotes doubled, fields with commas, quotes or newlines quoted. */
export function toCsv(rows: readonly Record<string, unknown>[], columns: readonly string[]) {
  const cell = (value: unknown) => {
    if (value === null || value === undefined) return "";
    const text = value instanceof Date ? value.toISOString() : typeof value === "object" ? JSON.stringify(value) : String(value);
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [columns.join(","), ...rows.map((row) => columns.map((c) => cell(row[c])).join(","))].join("\r\n");
}

async function context(db: Database, endeavourId: string | null) {
  const list = endeavourId
    ? await db.select().from(endeavours).where(eq(endeavours.id, endeavourId))
    : await db.select().from(endeavours).orderBy(asc(endeavours.createdAt));
  const ids = list.map((e) => e.id);
  if (ids.length === 0) return null;
  const [prospectRows, messageRows, opportunityRows, insightRows, segmentRows] = await Promise.all([
    db.select().from(prospects).where(inArray(prospects.endeavourId, ids)),
    db.select().from(messages).where(inArray(messages.endeavourId, ids)),
    db.select().from(opportunities).where(inArray(opportunities.endeavourId, ids)),
    db.select().from(insights).where(inArray(insights.endeavourId, ids)),
    db.select().from(segments).where(inArray(segments.endeavourId, ids)),
  ]);
  const companyIds = prospectRows.map((p) => p.companyId).filter((x): x is string => !!x);
  const personIds = prospectRows.map((p) => p.personId).filter((x): x is string => !!x);
  const [companyRows, personRows, evidenceRows] = await Promise.all([
    companyIds.length ? db.select().from(companies).where(inArray(companies.id, companyIds)) : [],
    personIds.length ? db.select().from(people).where(inArray(people.id, personIds)) : [],
    prospectRows.length ? db.select().from(evidence).where(inArray(evidence.entityId, prospectRows.map((p) => p.id))) : [],
  ]);
  return { list, prospectRows, messageRows, opportunityRows, insightRows, segmentRows, companyRows, personRows, evidenceRows };
}

/** Everything needed to restore or inspect the account, with generated ids intact. */
export async function exportJson(db: Database, endeavourId: string | null = null) {
  const data = await context(db, endeavourId);
  if (!data) return { exportedAt: new Date().toISOString(), endeavours: [] };
  return {
    exportedAt: new Date().toISOString(),
    endeavours: data.list,
    segments: data.segmentRows,
    companies: data.companyRows,
    people: data.personRows,
    prospects: data.prospectRows,
    evidence: data.evidenceRows,
    messages: data.messageRows,
    opportunities: data.opportunityRows,
    insights: data.insightRows,
  };
}

export async function exportCsv(db: Database, table: ExportTable, endeavourId: string | null = null) {
  const data = await context(db, endeavourId);
  if (!data) return toCsv([], ["id"]);
  const companyName = new Map(data.companyRows.map((c) => [c.id, c.name]));
  const personName = new Map(data.personRows.map((p) => [p.id, p.name]));
  const personEmail = new Map(data.personRows.map((p) => [p.id, p.email]));

  switch (table) {
    case "prospects": {
      const columns = ["id", "endeavourId", "company", "person", "email", "stage", "reviewStatus", "score", "nextAction", "createdAt"];
      return toCsv(
        data.prospectRows.map((p) => ({
          id: p.id,
          endeavourId: p.endeavourId,
          company: p.companyId ? companyName.get(p.companyId) : "",
          person: p.personId ? personName.get(p.personId) : "",
          email: p.personId ? personEmail.get(p.personId) : "",
          stage: p.stage,
          reviewStatus: p.reviewStatus,
          score: p.qualificationScore,
          nextAction: p.nextAction,
          createdAt: p.createdAt,
        })),
        columns,
      );
    }
    case "messages": {
      const columns = ["id", "endeavourId", "direction", "messageClass", "sendState", "subject", "sentAt", "receivedAt"];
      return toCsv(data.messageRows, columns);
    }
    case "opportunities":
      return toCsv(data.opportunityRows, ["id", "endeavourId", "name", "value", "currency", "stage", "expectedClose", "outcomeReason"]);
    case "insights":
      return toCsv(data.insightRows, ["id", "endeavourId", "type", "statement", "confidence", "status", "createdAt"]);
  }
}
