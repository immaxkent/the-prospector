import type { Opportunity, SegmentPerformance } from "@/data/types";
import type { PipelineStage } from "../domain/pipeline";
import { iso, type CompanyRow, type MessageRow, type OpportunityRow, type ProspectRow, type SegmentRow } from "./rows";

/** Shown only when the user has not set a probability. A prioritisation aid, not a forecast. */
export const DEFAULT_STAGE_PROBABILITY: Record<PipelineStage, number> = {
  discovered: 0.02,
  researched: 0.03,
  qualified: 0.05,
  contacted: 0.1,
  replied: 0.2,
  meeting: 0.35,
  proposal: 0.6,
  won: 1,
  lost: 0,
  nurture: 0.05,
};

export function buildOpportunity(
  o: OpportunityRow,
  prospects: ReadonlyMap<string, ProspectRow>,
  companies: ReadonlyMap<string, CompanyRow>,
): Opportunity {
  const prospect = o.prospectId ? prospects.get(o.prospectId) : undefined;
  const company = prospect?.companyId ? companies.get(prospect.companyId) : undefined;
  return {
    id: o.id,
    endeavourId: o.endeavourId,
    name: o.name,
    company: company?.name ?? "—",
    stage: o.stage,
    value: o.value,
    probability: o.probabilityUserDefined ?? DEFAULT_STAGE_PROBABILITY[o.stage],
    nextAction: prospect?.nextAction ?? "",
    updatedAt: iso(o.updatedAt),
  };
}

const MEETING_OR_LATER = new Set(["meeting", "proposal", "won"]);

export function buildSegmentPerformance(
  segments: readonly SegmentRow[],
  prospects: readonly ProspectRow[],
  messages: readonly MessageRow[],
): SegmentPerformance[] {
  return segments.map((s) => {
    const members = prospects.filter((p) => p.segmentId === s.id && p.reviewStatus !== "rejected");
    const ids = new Set(members.map((p) => p.id));
    const own = messages.filter((m) => m.prospectId && ids.has(m.prospectId));
    return {
      segment: s.name,
      sent: own.filter((m) => m.direction === "outbound" && m.messageClass === "new_outreach" && m.sendState === "sent").length,
      replies: new Set(own.filter((m) => m.direction === "inbound").map((m) => m.prospectId)).size,
      meetings: members.filter((p) => MEETING_OR_LATER.has(p.stage)).length,
      wins: members.filter((p) => p.stage === "won").length,
    };
  });
}
