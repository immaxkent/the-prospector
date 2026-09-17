import type { EvidenceItem, Prospect } from "@/data/types";
import {
  iso,
  type CompanyRow,
  type EvidenceRow,
  type MessageRow,
  type OpportunityRow,
  type PersonRow,
  type ProspectRow,
  type SegmentRow,
  type TriggerRow,
} from "./rows";

export function evidenceItem(e: EvidenceRow): EvidenceItem {
  let source: string = e.sourceType;
  let url: string | undefined;
  if (e.sourceType === "web") {
    try {
      const parsed = new URL(e.sourceRef);
      source = parsed.hostname.replace(/^www\./, "");
      url = parsed.toString();
    } catch {
      source = e.sourceRef;
    }
  } else {
    source = { import: "Import", manual: "Manual note", email: "Email" }[e.sourceType];
  }
  return { id: e.id, claim: e.claim, source, ...(url ? { url } : {}), observedAt: iso(e.capturedAt) };
}

export interface ProspectLookups {
  companies: ReadonlyMap<string, CompanyRow>;
  people: ReadonlyMap<string, PersonRow>;
  segments: ReadonlyMap<string, SegmentRow>;
  evidence: readonly EvidenceRow[];
  triggers: readonly TriggerRow[];
  messages: readonly MessageRow[];
  opportunities: readonly OpportunityRow[];
}

const FACTOR_LABELS: Record<string, string> = {
  icp_fit: "ICP fit",
  trigger_strength: "Trigger strength",
  likely_pain: "Likely pain",
  decision_maker: "Decision-maker relevance",
  evidence_quality: "Evidence quality",
  timing: "Timing",
  contactability: "Contactability",
};

const REVIEW_STATUS = {
  discovered: "DISCOVERED",
  researching: "RESEARCHING",
  qualified: "QUALIFIED",
  needs_review: "NEEDS_REVIEW",
  rejected: "REJECTED",
} as const;

export function buildProspect(p: ProspectRow, lookups: ProspectLookups): Prospect {
  const company = p.companyId ? lookups.companies.get(p.companyId) : undefined;
  const person = p.personId ? lookups.people.get(p.personId) : undefined;
  const entityIds = new Set([p.id, p.companyId, p.personId].filter(Boolean));
  const evidence = lookups.evidence
    .filter((e) => entityIds.has(e.entityId))
    .sort((a, b) => b.capturedAt.getTime() - a.capturedAt.getTime());
  const trigger = lookups.triggers
    .filter((t) => t.prospectId === p.id)
    .sort((a, b) => b.detectedAt.getTime() - a.detectedAt.getTime())[0];
  const touches = lookups.messages
    .filter((m) => m.prospectId === p.id)
    .map((m) => m.sentAt ?? m.receivedAt)
    .filter((d): d is Date => !!d)
    .sort((a, b) => b.getTime() - a.getTime());
  const openOpportunity = lookups.opportunities.find(
    (o) => o.prospectId === p.id && o.stage !== "won" && o.stage !== "lost",
  );

  return {
    id: p.id,
    endeavourId: p.endeavourId,
    score: p.qualificationScore ?? 0,
    scoreFactors: p.scoreFactors.map((f) => ({
      label: FACTOR_LABELS[f.factor] ?? f.factor,
      weight: Math.round(f.score * f.weight * 10),
      note: f.note,
      evidenceIds: f.evidenceIds,
    })),
    person: person?.name ?? "Unknown contact",
    role: person?.role ?? "",
    company: company?.name ?? "Unknown company",
    segment: p.segmentId ? (lookups.segments.get(p.segmentId)?.name ?? "") : "",
    trigger: trigger?.description ?? "",
    evidence: evidence.map(evidenceItem),
    fitFactors: p.scoreFactors.filter((f) => f.score >= 7).map((f) => FACTOR_LABELS[f.factor] ?? f.factor),
    stage: p.reviewStatus === "rejected" ? "rejected" : p.stage,
    lastTouch: touches[0] ? iso(touches[0]) : null,
    nextAction: p.nextAction ?? (p.reviewStatus === "rejected" ? `Rejected: ${p.rejectionReason ?? "no reason"}` : ""),
    opportunityValue: openOpportunity?.value ?? null,
    status: REVIEW_STATUS[p.reviewStatus],
  };
}
