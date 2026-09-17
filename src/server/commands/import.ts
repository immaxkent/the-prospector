/**
 * Importing prospects from outside. Imported rows go through the same checks as researched
 * ones: suppression, deduplication, and evidence kept with its source.
 */
import { z } from "zod/v4";
import type { Database } from "../db/client";
import type { Candidate } from "../agent/research";
import { storeCandidates } from "./research";
import { invalid, notFound } from "./errors";
import { eq } from "drizzle-orm";
import { endeavours, segments } from "../db/schema";

export const importRowSchema = z.object({
  company: z.string().trim().min(1).max(200),
  domain: z.string().trim().max(200).optional(),
  person: z.string().trim().max(120).optional(),
  role: z.string().trim().max(120).optional(),
  email: z.email().optional(),
  linkedinUrl: z.url().optional(),
  trigger: z.string().trim().max(300).optional(),
  note: z.string().trim().max(600).optional(),
  source: z.string().trim().max(200).optional(),
});

export const importSchema = z.object({
  endeavourId: z.string().trim().min(1).max(64),
  segmentId: z.string().trim().max(64).optional(),
  rows: z.array(importRowSchema).min(1).max(500),
});

export type ImportRow = z.infer<typeof importRowSchema>;

/** An imported row becomes a candidate whose evidence is the importer's own note. */
export function rowToCandidate(row: ImportRow): Candidate {
  const claim = row.note ?? row.trigger ?? `Imported from ${row.source ?? "a list"}`;
  return {
    company: { name: row.company, ...(row.domain ? { domain: row.domain } : {}) },
    ...(row.person
      ? {
          person: {
            name: row.person,
            ...(row.role ? { role: row.role } : {}),
            ...(row.email ? { email: row.email } : {}),
            ...(row.linkedinUrl ? { linkedinUrl: row.linkedinUrl } : {}),
          },
        }
      : {}),
    trigger: { type: "import", description: row.trigger ?? "Added by import" },
    evidence: [{ claim, sourceRef: row.source ?? "operator import", excerpt: claim, confidence: 0.5 }],
  };
}

export async function importProspects(db: Database, input: z.infer<typeof importSchema>) {
  const parsed = importSchema.safeParse(input);
  if (!parsed.success) throw invalid(z.prettifyError(parsed.error));
  const data = parsed.data;

  const [endeavour] = await db.select({ id: endeavours.id }).from(endeavours).where(eq(endeavours.id, data.endeavourId));
  if (!endeavour) throw notFound("endeavour");
  if (data.segmentId) {
    const [segment] = await db.select({ id: segments.id }).from(segments).where(eq(segments.id, data.segmentId));
    if (!segment) throw notFound("segment");
  }

  const result = await storeCandidates(db, {
    endeavourId: data.endeavourId,
    segmentId: data.segmentId ?? null,
    candidates: data.rows.map(rowToCandidate),
    source: "import",
    evidenceSourceType: "import",
  });
  return { imported: result.created.length, suppressed: result.suppressed, duplicates: result.duplicates };
}

/** Parses a small CSV (header row required) into import rows. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') quoted = false;
      else field += char;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") field += char;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  const [header, ...body] = rows.filter((r) => r.some((cell) => cell.trim() !== ""));
  if (!header) return [];
  const columns = header.map((h) => h.trim());
  return body.map((cells) => Object.fromEntries(columns.map((column, i) => [column, (cells[i] ?? "").trim()])));
}
