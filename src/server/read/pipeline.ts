import type { Opportunity } from "@/data/types";
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

