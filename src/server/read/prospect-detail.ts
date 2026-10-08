/**
 * Everything known about one prospect, assembled once.
 *
 * It was spread across four screens: the prospects inspector had the score, the mailbox had
 * the thread, the interaction log had what happened off-channel, and the evidence table had
 * what any of it rested on. Deciding whether to write to someone meant holding all four in
 * your head, so in practice the decision was made on the score alone.
 *
 * The assembling is pure — rows in, one object out — so what it decides can be tested
 * without a database, and the queries stay where the queries are.
 */
import type { ProspectDetail, TimelineEntry } from "@/data/types";
import { contactRoutes } from "@/data/contact-routes";
import { buildProspect, type ProspectLookups } from "./prospects";

export { contactRoutes };
import { iso, type EventRow, type InteractionRow, type ProspectRow } from "./rows";

const DECISION_TITLE: Record<string, string> = {
  "prospect.released": "Released for outreach",
  "prospect.rejected": "Rejected",
  "prospect.restored": "Restored for review",
  "prospect.resolved": "Cleared from the buffer",
  "prospect.suppressed": "Suppressed",
  "prospect.stage_changed": "Stage changed",
  "prospect.meeting_set": "Meeting set",
  "opportunity.won": "Won",
};

const payloadText = (payload: Record<string, unknown>, key: string): string =>
  typeof payload[key] === "string" ? (payload[key] as string) : "";

/**
 * One tape of everything that happened, newest first.
 *
 * Assembled from the tables that recorded each kind rather than from a single history table,
 * because there is no single history table and inventing one would mean nothing before it
 * ever happened. The event log covers the decisions; evidence, messages and interactions
 * cover the rest.
 */
export function prospectTimeline(input: {
  prospect: ProspectRow;
  lookups: Pick<ProspectLookups, "evidence" | "triggers" | "messages">;
  interactions: readonly InteractionRow[];
  events: readonly EventRow[];
  /** The ids whose evidence belongs to this prospect: itself, its company, its person. */
  entityIds: ReadonlySet<string>;
}): TimelineEntry[] {
  const out: TimelineEntry[] = [];

  for (const e of input.lookups.evidence) {
    if (!input.entityIds.has(e.entityId)) continue;
    const url = e.sourceType === "web" ? e.sourceRef : undefined;
    out.push({
      id: e.id,
      kind: "research",
      at: iso(e.capturedAt),
      title: e.claim,
      detail: e.excerpt ?? "",
      ...(url ? { url } : {}),
    });
  }

  for (const t of input.lookups.triggers) {
    if (t.prospectId !== input.prospect.id) continue;
    out.push({
      id: t.id,
      kind: "trigger",
      at: iso(t.detectedAt),
      title: t.description,
      // The date the thing happened, which is not the date it was noticed.
      detail: t.occurredOn ? `Happened ${t.occurredOn}` : "No date recorded",
    });
  }

  if (input.prospect.qualificationScore !== null) {
    out.push({
      id: `${input.prospect.id}:qualified`,
      kind: "qualified",
      at: iso(input.prospect.updatedAt),
      title: `Scored ${input.prospect.qualificationScore}`,
      detail: input.prospect.scoreReason ?? "",
    });
  }

  if (input.prospect.releasedAt) {
    out.push({
      id: `${input.prospect.id}:released`,
      kind: "released",
      at: iso(input.prospect.releasedAt),
      title: "You released this one",
      detail: "Nothing is drafted before this.",
    });
  }

  for (const m of input.lookups.messages) {
    if (m.prospectId !== input.prospect.id) continue;
    /*
     * A send that failed belongs here, not only in the digest.
     *
     * It has no sent time — it never went — so the rule below would have dropped it, and the
     * only place it showed was a line in a daily report nobody re-reads. A prospect who
     * looks contacted and was not is the worst state this app can be in: the operator stops
     * chasing and the agent stops trying.
     */
    if (m.sendState === "failed") {
      out.push({
        id: m.id,
        kind: "failed",
        at: iso(m.updatedAt),
        title: `Could not send: ${m.subject}`,
        detail:
          m.lastError ??
          `Tried ${m.sendAttempts} time${m.sendAttempts === 1 ? "" : "s"}, no reason recorded`,
      });
      continue;
    }
    const at = m.sentAt ?? m.receivedAt;
    if (!at) continue;
    out.push({
      id: m.id,
      kind: m.direction === "outbound" ? "sent" : "received",
      at: iso(at),
      title: m.subject,
      detail: m.body.slice(0, 280),
    });
  }

  for (const i of input.interactions) {
    if (i.prospectId !== input.prospect.id) continue;
    out.push({
      id: i.id,
      kind: "elsewhere",
      at: iso(i.occurredAt),
      title:
        i.direction === "inbound"
          ? `They answered on ${i.channel}`
          : `You reached out on ${i.channel}`,
      detail: i.note ?? "",
    });
  }

  for (const e of input.events) {
    const title = DECISION_TITLE[e.eventType];
    if (!title) continue;
    const detail = payloadText(e.payload, "reason") || payloadText(e.payload, "detail");
    out.push({ id: e.id, kind: "decision", at: iso(e.occurredAt), title, detail });
  }

  // Newest first, and ties broken by id so the order does not wobble between reads.
  return out.sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id));
}

export function buildProspectDetail(
  p: ProspectRow,
  lookups: ProspectLookups,
  extra: { interactions: readonly InteractionRow[]; events: readonly EventRow[] },
): ProspectDetail {
  const base = buildProspect(p, lookups);
  const company = p.companyId ? lookups.companies.get(p.companyId) : undefined;
  const person = p.personId ? lookups.people.get(p.personId) : undefined;
  const entityIds = new Set([p.id, p.companyId, p.personId].filter((x): x is string => !!x));

  return {
    ...base,
    personEmail: person?.email ?? null,
    linkedinUrl: person?.linkedinUrl ?? null,
    companyName: company?.name ?? "Unknown company",
    companyDomain: company?.domain ?? null,
    companyTimezone: company?.timezone ?? null,
    routes: contactRoutes({
      personEmail: person?.email ?? null,
      linkedinUrl: person?.linkedinUrl ?? null,
      contacts: company?.contacts ?? [],
    }),
    timeline: prospectTimeline({ prospect: p, lookups, entityIds, ...extra }),
  };
}
