/**
 * How much work is already in front of the operator.
 *
 * Prospecting is a buffer the system keeps full, not a quota it keeps hitting. That only
 * works if "full" is counted the same way everywhere, so the counting lives here and
 * nothing else decides what pending means.
 *
 * Both populations come off stages that already exist. Nothing is written to record them,
 * which matters: a count derived from the pipeline cannot drift from the pipeline.
 */
import type { PipelineStage } from "./pipeline";

/**
 * Found, perhaps written to, no answer yet.
 *
 * `discovered` and `researched` are in it because an unreleased prospect is still the
 * operator's to deal with — it cost money to find and it is waiting on a decision. Leaving
 * it out would let the system research without limit as long as nobody released anything,
 * which is the exact waste the cap exists to stop.
 */
export const PENDING_STAGES: readonly PipelineStage[] = ["discovered", "researched", "qualified", "contacted"];

/**
 * They answered, and the operator answered back.
 *
 * `won` is not here. A closed deal is not a conversation in progress, and holding a slot
 * for it would make a good outcome look like a busy one.
 */
export const ACTIVE_STAGES: readonly PipelineStage[] = ["replied", "meeting", "proposal"];

/** The fields the count needs. Deliberately narrow, so a caller can pass anything shaped like this. */
export interface CountableProspect {
  stage: PipelineStage;
  reviewStatus: string;
  segmentId: string | null;
}

/**
 * A rejected prospect frees its slot wherever it sits.
 *
 * Rejection is recorded beside the stage rather than in it — the operator can reject
 * something that qualification liked — so a stage test alone would keep counting it.
 */
const isRejected = (p: CountableProspect) => p.reviewStatus === "rejected";

export const isPending = (p: CountableProspect) => !isRejected(p) && PENDING_STAGES.includes(p.stage);
export const isActive = (p: CountableProspect) => !isRejected(p) && ACTIVE_STAGES.includes(p.stage);

export interface ProspectingCount {
  pending: number;
  active: number;
  /** Pending only, by segment id. Prospects with no segment are counted in the total and nowhere else. */
  pendingBySegment: Map<string, number>;
}

export function countProspecting(prospects: readonly CountableProspect[]): ProspectingCount {
  const pendingBySegment = new Map<string, number>();
  let pending = 0;
  let active = 0;

  for (const prospect of prospects) {
    if (isActive(prospect)) {
      active += 1;
      continue;
    }
    if (!isPending(prospect)) continue;
    pending += 1;
    // A prospect whose segment was retired still occupies a slot. It has nowhere to be
    // counted per-segment, and inventing a bucket for it would hand that segment an
    // allowance it no longer has.
    if (prospect.segmentId) pendingBySegment.set(prospect.segmentId, (pendingBySegment.get(prospect.segmentId) ?? 0) + 1);
  }

  return { pending, active, pendingBySegment };
}
