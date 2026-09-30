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

/* ---------- setpoints ---------- */

/**
 * The two numbers the operator sets, and the switch that overrides both.
 *
 * Defaults only. An endeavour with a different rhythm, or an operator with a different
 * appetite for reviewing, sets its own — these are what a new endeavour starts with.
 */
export const DEFAULT_MAXIMUM_PENDING = 50;
export const DEFAULT_ACTIVE_GOAL = 20;

/**
 * Bounds, not preferences.
 *
 * The ceilings are absurdity guards rather than advice: nobody can hold a thousand
 * conversations, and a cap that large means a typo. The floor is one, because an operator
 * who wants to work a single prospect at a time is entitled to.
 */
export const PENDING_CAP_RANGE = { min: 1, max: 500 } as const;
export const ACTIVE_GOAL_RANGE = { min: 1, max: 200 } as const;

export interface ProspectingSettings {
  maximumPending: number;
  activeGoal: number;
  /** The operator's own stop, independent of either number. */
  paused: boolean;
}

export const DEFAULT_PROSPECTING: ProspectingSettings = {
  maximumPending: DEFAULT_MAXIMUM_PENDING,
  activeGoal: DEFAULT_ACTIVE_GOAL,
  paused: false,
};

const withinOr = (value: unknown, range: { min: number; max: number }, fallback: number) => {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(range.max, Math.max(range.min, Math.round(value)));
};

/**
 * Reading a stored value, which must never throw: settings written by an older version, or
 * by hand, should degrade to the default rather than take the endeavour down.
 *
 * Input from the operator is a different question and is refused with a reason instead —
 * silently turning 500 into 200 while they watch is worse than saying no.
 */
export function normaliseProspecting(stored: Partial<ProspectingSettings> | null | undefined): ProspectingSettings {
  return {
    maximumPending: withinOr(stored?.maximumPending, PENDING_CAP_RANGE, DEFAULT_MAXIMUM_PENDING),
    activeGoal: withinOr(stored?.activeGoal, ACTIVE_GOAL_RANGE, DEFAULT_ACTIVE_GOAL),
    paused: stored?.paused === true,
  };
}

/** Why prospecting is not running, in the operator's terms. Null when it should run. */
export type ProspectingHalt = "paused" | "buffer_full" | "goal_met";

/**
 * Whether to look for anyone new, and if not, which of the three reasons it is.
 *
 * The reason is returned rather than a bare boolean because a stall the operator cannot
 * account for reads as the system having died. Every caller that stops has to be able to
 * say why it stopped.
 */
export function prospectingHalt(count: ProspectingCount, settings: ProspectingSettings): ProspectingHalt | null {
  if (settings.paused) return "paused";
  // The goal is checked before the buffer: reaching it is success, and reporting it as a
  // full queue would tell the operator to go and clear work that is doing its job.
  if (count.active >= settings.activeGoal) return "goal_met";
  if (count.pending >= settings.maximumPending) return "buffer_full";
  return null;
}
