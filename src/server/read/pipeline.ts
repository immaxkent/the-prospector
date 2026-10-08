import type { Opportunity } from "@/data/types";
import type { PipelineStage } from "../domain/pipeline";
import { iso, type CompanyRow, type MessageRow, type OpportunityRow, type ProspectRow, type SegmentRow } from "./rows";

/** One table of stage defaults, shared with the forecast that weights deals by them. */
export { DEFAULT_STAGE_PROBABILITY } from "@/data/forecast";
import { DEFAULT_STAGE_PROBABILITY } from "@/data/forecast";

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

