/**
 * Releasing a prospect: the operator saying this one is worth writing to.
 *
 * Qualification decides whether a prospect fits the segment. That is the agent's work, and
 * it is done on evidence it found itself. Deciding who actually gets an email is not, so
 * nothing is drafted until this has happened.
 *
 * A prospect the model sent to review can be released just as a qualified one can — the
 * whole point of review is that a person looks. Releasing never rewrites the assessment;
 * the score and the reason stand as they were.
 */
import { and, eq, inArray } from "drizzle-orm";
import type { Database } from "../db/client";
import { companies, prospects } from "../db/schema";
import { dedupeContacts, type CompanyContact, type ContactChannel } from "../domain/contacts";
import { conflict, invalid, notFound } from "./errors";
import { recordEvent, type Executor } from "./events";

/** Outcomes a person may act on. A rejected prospect is not released; it is re-qualified or left. */
const RELEASABLE = ["qualified", "needs_review"] as const;

export interface ReleaseResult {
  released: string[];
  /** Ids that were asked for and could not be released, with why. */
  refused: { id: string; reason: string }[];
}

/**
 * Releases one or more prospects.
 *
 * Bulk on purpose: reviewing is per-prospect but the decisions arrive together, and a
 * round trip per tick makes twenty of them a chore. Each id is judged on its own, so one
 * bad id in a batch does not lose the other nineteen — the refusals come back named.
 */
export async function releaseProspects(
  db: Database,
  input: { endeavourId: string; prospectIds: readonly string[] },
  now = new Date(),
): Promise<ReleaseResult> {
  const ids = [...new Set(input.prospectIds)].filter((id) => id.trim());
  if (ids.length === 0) throw invalid("choose at least one prospect to release");

  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(prospects)
      .where(and(eq(prospects.endeavourId, input.endeavourId), inArray(prospects.id, ids)));

    const result: ReleaseResult = { released: [], refused: [] };
    const found = new Map(rows.map((r) => [r.id, r]));

    for (const id of ids) {
      const row = found.get(id);
      if (!row) {
        result.refused.push({ id, reason: "not a prospect of this endeavour" });
        continue;
      }
      if (row.releasedAt) {
        // Already released is not a failure: the operator gets the state they asked for.
        result.released.push(id);
        continue;
      }
      if (!RELEASABLE.includes(row.reviewStatus as (typeof RELEASABLE)[number])) {
        result.refused.push({ id, reason: `${row.reviewStatus.replace("_", " ")} prospects are not released` });
        continue;
      }
      result.released.push(id);
    }

    const toWrite = result.released.filter((id) => !found.get(id)?.releasedAt);
    if (toWrite.length > 0) {
      await tx.update(prospects).set({ releasedAt: now }).where(inArray(prospects.id, toWrite));
      // One event for the batch. Twenty rows saying the same thing is not a record of
      // anything; it is the same decision written out twenty times.
      await recordEvent(tx, {
        eventType: "prospect.released",
        entityType: "endeavour",
        entityId: input.endeavourId,
        endeavourId: input.endeavourId,
        detail: `${toWrite.length} prospect(s) cleared for outreach`,
        data: { prospectIds: toWrite },
      });
    }
    return result;
  });
}

/** Takes a prospect back off the list. Nothing already drafted is withdrawn by this. */
export async function holdProspect(db: Database, input: { prospectId: string }) {
  const [row] = await db
    .update(prospects)
    .set({ releasedAt: null })
    .where(eq(prospects.id, input.prospectId))
    .returning({ id: prospects.id });
  if (!row) throw notFound("prospect");
  return { id: row.id };
}

/**
 * Adds a contact the operator found themselves.
 *
 * The agent reports only what a page showed it, which leaves gaps a person can close in a
 * minute. What is added here is indistinguishable from what research found, because by the
 * time it is used the difference does not matter — and it survives the next research pass
 * for the same reason.
 */
export async function addCompanyContact(
  db: Database,
  input: { companyId: string; channel: ContactChannel; value: string; sourceRef?: string },
) {
  const value = input.value.trim();
  if (!value) throw invalid("the contact cannot be empty");
  if (input.channel === "email" && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) {
    throw invalid("that does not look like an email address");
  }

  return db.transaction(async (tx: Executor) => {
    const [company] = await tx.select().from(companies).where(eq(companies.id, input.companyId));
    if (!company) throw notFound("company");

    const contact: CompanyContact = { channel: input.channel, value };
    if (input.sourceRef?.trim()) contact.sourceRef = input.sourceRef.trim();

    const merged = dedupeContacts([...company.contacts, contact]);
    if (merged.length === company.contacts.length) throw conflict("this company already has that contact");

    await tx.update(companies).set({ contacts: merged }).where(eq(companies.id, company.id));
    return { contacts: merged };
  });
}
