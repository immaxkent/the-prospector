/**
 * Dividing a day's model budget between the phases of a run.
 *
 * A run is four phases that all cost money, and nothing stopped the first one spending all
 * of it. On 1 October research used $0.68 of a ~$0.61 day; eighteen prospects were found
 * and not one of them was scored, because qualification had nothing left to spend. The run
 * reported "stopping at 0 of 20 qualified", which was true and useless — the money was gone
 * before the sentence was written.
 *
 * This is not a budget-too-small problem. At any budget, an unsplit day lets discovery
 * starve judgement, and discovery is the phase whose output is worthless without judgement.
 */

/** In the order a run performs them, which is also the order surplus flows down. */
export const PHASE_ORDER = ["reply", "research", "qualify", "draft"] as const;
export type RunPhase = (typeof PHASE_ORDER)[number];

/**
 * How the day is divided.
 *
 * Research gets the largest share because its appetite is unbounded — it can always look
 * harder — while every other phase is bounded by what research produced. That is also
 * exactly why it cannot have the lot.
 *
 * Reply is smallest and first. It is a handful of cheap calls, but a reply nobody reads is
 * a lost deal, so it is never the phase that goes without.
 */
export const PHASE_SHARE: Record<RunPhase, number> = {
  reply: 0.1,
  research: 0.45,
  qualify: 0.25,
  draft: 0.2,
};

/** Which phase a model call belongs to. Null for work no daily run does. */
export function phaseOf(role: string): RunPhase | null {
  if (role === "research.discover") return "research";
  if (role === "research.qualify") return "qualify";
  if (role === "outreach.draft") return "draft";
  if (role === "conversation.classify") return "reply";
  // Intake and the weekly review are not run phases: a person is waiting on the first and
  // the second is a few hundred tokens a week. Both answer to the day's budget alone.
  return null;
}

/**
 * The day's allowance split into whole pence that still add up to the allowance.
 *
 * Largest remainder, so nothing is lost to rounding — on a 48p day the pence matter.
 */
export function phaseBudgets(allowancePence: number): Record<RunPhase, number> {
  const allowance = Math.max(0, Math.floor(allowancePence));
  const exact = PHASE_ORDER.map((phase) => ({ phase, want: allowance * PHASE_SHARE[phase] }));
  const budgets = Object.fromEntries(exact.map((e) => [e.phase, Math.floor(e.want)])) as Record<RunPhase, number>;

  let left = allowance - PHASE_ORDER.reduce((sum, phase) => sum + budgets[phase], 0);
  for (const entry of [...exact].sort((a, b) => (b.want % 1) - (a.want % 1))) {
    if (left <= 0) break;
    budgets[entry.phase] += 1;
    left -= 1;
  }
  return budgets;
}

/**
 * What a phase may spend: its own share, plus whatever the phases before it did not use.
 *
 * A floor that could not be exceeded would waste the budget — a quiet morning with no
 * replies to classify would simply lose that tenth of the day. Surplus only flows forwards,
 * because a phase that has already run cannot give back what it has not yet spent.
 */
export function phaseAllowancePence(
  phase: RunPhase,
  allowancePence: number,
  spentByPhase: Readonly<Partial<Record<RunPhase, number>>>,
): number {
  const budgets = phaseBudgets(allowancePence);
  const earlier = PHASE_ORDER.slice(0, PHASE_ORDER.indexOf(phase));
  const surplus = earlier.reduce((sum, p) => sum + Math.max(0, budgets[p] - (spentByPhase[p] ?? 0)), 0);
  return budgets[phase] + surplus;
}

export interface PhaseVerdict {
  allowed: boolean;
  /** What this phase may spend in total today, including inherited surplus. */
  allowancePence: number;
  spentPence: number;
}

/** Whether this phase may make another call. The day's own budget is checked separately. */
export function phaseVerdict(
  phase: RunPhase,
  allowancePence: number,
  spentByPhase: Readonly<Partial<Record<RunPhase, number>>>,
): PhaseVerdict {
  const allowance = phaseAllowancePence(phase, allowancePence, spentByPhase);
  const spent = spentByPhase[phase] ?? 0;
  return { allowed: spent < allowance, allowancePence: allowance, spentPence: spent };
}

/** Said against the phase's own name, so nobody reads it as the whole day being gone. */
export const phaseExhausted = (phase: RunPhase, verdict: PhaseVerdict) =>
  `${phase} has spent its share of today (${verdict.spentPence}p of ${verdict.allowancePence}p); the other phases keep theirs`;
