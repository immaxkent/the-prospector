/**
 * How much work today is worth doing.
 *
 * The operator's cadence is a ceiling, not a target. What the endeavour actually needs falls
 * as the pipeline fills: a conversation already under way carries part of the objective, and
 * work started today only has to cover what is left. The arithmetic runs the other way too —
 * when the gap cannot be closed at the rates observed, it says so rather than quietly aiming
 * at a number nobody can hit.
 *
 * Rates are measured where there is enough evidence and declared priors where there is not.
 * Which one was used is reported, because a forecast built on assumptions should say so.
 */

/** Below this many sends, a rate says more about luck than about the market. */
export const RATE_MIN_SAMPLE = 15;

/**
 * Conservative defaults for cold email to strangers. Deliberately pessimistic: starting too
 * much work wastes a little money, starting too little wastes the horizon.
 */
export const PRIOR_RATES = { reply: 0.05, meetingFromReply: 0.3, winFromMeeting: 0.25 } as const;

export type RateSource = "measured" | "prior" | "mixed";

export interface Observed {
  /** Outbound messages actually sent, and how many drew a reply. */
  sent: number;
  replies: number;
  /** Prospects that reached a meeting, and those that were won. */
  meetings: number;
  wins: number;
}

export interface PipelineStage {
  /** How many prospects sit at this stage right now. */
  count: number;
  /** Probability one of them is eventually won, from here. */
  probability: number;
}

export interface WorkloadInput {
  /**
   * What the objective is counted in. Money for a revenue objective, and plain units for
   * one counted in partnerships, customers or meetings — where each win is worth exactly
   * one and there is no price to reason about.
   */
  unit?: "money" | "count";
  /** Value still to win, before counting the pipeline. */
  objectiveValue: number;
  wonValue: number;
  /** What one win is worth. Zero when unknown, which makes the forecast unavailable. */
  dealValue: number;
  /** Where that figure came from, so the brief can say whether it is evidence or an estimate. */
  dealValueSource?: "measured" | "expected" | "fixed" | "minimum";
  /** Live prospects by stage, with each stage's chance of becoming a win. */
  pipeline: readonly PipelineStage[];
  observed: Observed;
  /** The operator's stated ceiling for new prospects a day. */
  dailyCeiling: number;
  /** Sends the mailbox can still make today. */
  capacityToday: number;
  /** Days left in the sprint, or the review period for an ongoing endeavour. At least 1. */
  daysRemaining: number;
}

export interface Workload {
  /** How many new prospects to start today, after every ceiling. */
  newProspects: number;
  /** What the arithmetic asked for, before ceilings. */
  wanted: number;
  /** Value still needed once the pipeline's expected contribution is counted. */
  gap: number;
  expectedFromPipeline: number;
  rates: { reply: number; meetingFromReply: number; winFromMeeting: number; perProspect: number; source: RateSource };
  limitedBy: "nothing" | "cadence" | "capacity" | "objective_met" | "unknowable";
  /** False when the gap cannot be closed in the time left at these rates. */
  feasible: boolean;
  /** Sentences for the daily brief, in the operator's terms. */
  notes: string[];
}

const ratio = (part: number, whole: number) => (whole > 0 ? part / whole : 0);

/** A measured rate where the sample earns it, otherwise the prior. */
function rateOf(part: number, whole: number, prior: number): { value: number; measured: boolean } {
  if (whole < RATE_MIN_SAMPLE) return { value: prior, measured: false };
  return { value: ratio(part, whole), measured: true };
}

export function planWorkload(input: WorkloadInput): Workload {
  const notes: string[] = [];
  const days = Math.max(1, Math.floor(input.daysRemaining));

  const reply = rateOf(input.observed.replies, input.observed.sent, PRIOR_RATES.reply);
  const meeting = rateOf(input.observed.meetings, input.observed.replies, PRIOR_RATES.meetingFromReply);
  const win = rateOf(input.observed.wins, input.observed.meetings, PRIOR_RATES.winFromMeeting);
  const measured = [reply, meeting, win].filter((r) => r.measured).length;
  const source: RateSource = measured === 3 ? "measured" : measured === 0 ? "prior" : "mixed";
  const perProspect = reply.value * meeting.value * win.value;

  const expectedFromPipeline = input.pipeline.reduce((sum, s) => sum + s.count * s.probability * input.dealValue, 0);
  const gap = Math.max(0, input.objectiveValue - input.wonValue - expectedFromPipeline);

  const rates = { reply: reply.value, meetingFromReply: meeting.value, winFromMeeting: win.value, perProspect, source };

  if (gap === 0) {
    notes.push("The objective is covered by what is won and what is already in the pipeline; no new prospects are needed today.");
    return { newProspects: 0, wanted: 0, gap, expectedFromPipeline, rates, limitedBy: "objective_met", feasible: true, notes };
  }

  // Without a deal value or a conversion rate there is no arithmetic to do; fall back to the
  // operator's ceiling rather than inventing a number.
  if (input.dealValue <= 0 || perProspect <= 0) {
    const fallback = Math.max(0, Math.min(input.dailyCeiling, input.capacityToday));
    notes.push("There is no deal value or conversion rate to work from, so today follows the stated cadence rather than the objective.");
    return { newProspects: fallback, wanted: input.dailyCeiling, gap, expectedFromPipeline, rates, limitedBy: "unknowable", feasible: true, notes };
  }

  const winsNeeded = gap / input.dealValue;
  const prospectsNeeded = Math.ceil(winsNeeded / perProspect);
  const wanted = Math.ceil(prospectsNeeded / days);

  const afterCadence = Math.min(wanted, input.dailyCeiling);
  const newProspects = Math.max(0, Math.min(afterCadence, input.capacityToday));
  // Whichever ceiling actually binds, not whichever is checked first.
  const limitedBy =
    newProspects >= wanted ? "nothing" : input.capacityToday <= afterCadence ? "capacity" : "cadence";

  const feasible = wanted <= input.dailyCeiling;
  notes.push(
    `£${Math.round(gap)} still to win over ${days} day(s). At ${source === "prior" ? "assumed" : "observed"} rates that is ${prospectsNeeded} prospect(s), or ${wanted} a day.`,
  );
  if (expectedFromPipeline > 0) {
    notes.push(`The pipeline is already expected to bring £${Math.round(expectedFromPipeline)}, which is subtracted from the target.`);
  }
  if (!feasible) {
    notes.push(
      `That is more than the cadence of ${input.dailyCeiling} a day allows, so the objective is out of reach at these rates: raise the cadence, raise the price, or move the date.`,
    );
  }
  if (limitedBy === "capacity") {
    notes.push(`The mailbox can only send ${input.capacityToday} more today, so that is the limit.`);
  }
  if (input.unit === "count") {
    notes.push(`${Math.ceil(gap)} more to win, and each one counts once: there is no price to forecast from here.`);
  } else if (input.dealValueSource === "minimum") {
    notes.push(
      "There is no typical deal value set, so the forecast uses the minimum you would accept. That is the pessimistic case: set a typical value to see a realistic one.",
    );
  } else if (input.dealValueSource === "measured") {
    notes.push(`A deal is worth £${Math.round(input.dealValue)} on the evidence of the ones actually won.`);
  }
  if (source !== "measured") {
    notes.push(
      `These are ${source === "prior" ? "assumed rates, not measured ones" : "part assumed and part measured"}: a rate needs ${RATE_MIN_SAMPLE} sends before it means anything.`,
    );
  }

  return { newProspects, wanted, gap, expectedFromPipeline, rates, limitedBy, feasible, notes };
}
