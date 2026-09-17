import type { Approval, ApprovalKind } from "@/data/types";
import { evidenceItem } from "./prospects";
import {
  iso,
  type ApprovalRow,
  type EvidenceRow,
  type MessageRow,
  type OpportunityRow,
  type PersonRow,
  type ProspectRow,
  type ThreadRow,
} from "./rows";

export interface ApprovalLookups {
  messages: ReadonlyMap<string, MessageRow>;
  threads: ReadonlyMap<string, ThreadRow>;
  prospects: ReadonlyMap<string, ProspectRow>;
  people: ReadonlyMap<string, PersonRow>;
  opportunities: readonly OpportunityRow[];
  evidence: ReadonlyMap<string, EvidenceRow>;
}

const TITLES: Record<ApprovalRow["kind"], string> = {
  outreach_draft: "New outreach ready to send",
  reply_approval: "Reply drafted for approval",
  hot_lead: "High-value opportunity",
  pricing_decision: "Pricing decision needed",
  thread_mapping: "Reply could not be matched",
  failed_run: "Daily run failed",
};

const str = (v: unknown) => (typeof v === "string" ? v : "");

function prospectIdFor(a: ApprovalRow, l: ApprovalLookups) {
  switch (a.subjectType) {
    case "prospect":
      return a.subjectId;
    case "message":
      return l.messages.get(a.subjectId)?.prospectId ?? null;
    case "thread":
      return l.threads.get(a.subjectId)?.prospectId ?? null;
    case "opportunity":
      return l.opportunities.find((o) => o.id === a.subjectId)?.prospectId ?? null;
    default:
      return null;
  }
}

export function buildApproval(a: ApprovalRow, l: ApprovalLookups): Approval {
  const prospect = (() => {
    const id = prospectIdFor(a, l);
    return id ? l.prospects.get(id) : undefined;
  })();
  const person = prospect?.personId ? l.people.get(prospect.personId) : undefined;
  const message = a.subjectType === "message" ? l.messages.get(a.subjectId) : undefined;
  const opportunity = prospect
    ? l.opportunities.find((o) => o.prospectId === prospect.id && o.stage !== "won" && o.stage !== "lost")
    : undefined;
  const evidenceIds = message?.evidenceIds ?? (Array.isArray(a.payload["evidenceIds"]) ? (a.payload["evidenceIds"] as string[]) : []);

  return {
    id: a.id,
    endeavourId: a.endeavourId,
    kind: a.kind.toUpperCase() as ApprovalKind,
    title: str(a.payload["title"]) || TITLES[a.kind],
    recipient: person ? `${person.name}${person.email ? ` <${person.email}>` : ""}` : str(a.payload["recipient"]) || "—",
    why: str(a.payload["why"]),
    copy: message?.body ?? str(a.payload["draft"]),
    value: opportunity?.value ?? null,
    evidence: evidenceIds.map((id) => l.evidence.get(id)).filter((e): e is EvidenceRow => !!e).map(evidenceItem),
    createdAt: iso(a.createdAt),
  };
}
