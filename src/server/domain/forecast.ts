/**
 * What the open deals are worth, and how much of that is a guess.
 *
 * The objective read pipeline value as the full face value of every open deal, which says a
 * £6,000 proposal and a £6,000 prospect who has not replied are the same thing. They are
 * not, and the difference is the whole question a forecast answers.
 *
 * Each deal is weighted. Where the operator set a probability, that is used; where they did
 * not, the stage's default stands in — and the share of the forecast resting on those
 * defaults is reported, because a forecast built entirely out of assumed rates is a
 * restatement of the stage counts rather than a forecast.
 */
import type { PipelineStage } from "./pipeline";

/** Stood in where the operator has not said. A prioritisation aid, not a claim. */
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

const CLOSED: readonly PipelineStage[] = ["won", "lost"];
export const isClosed = (stage: PipelineStage) => CLOSED.includes(stage);

export interface ForecastDeal {
  stage: PipelineStage;
  value: number;
  /** What the operator said, or null when nobody has. */
  probabilityUserDefined: number | null;
}

export interface Forecast {
  /** Face value of every open deal. What the objective used to read. */
  openValue: number;
  /** The same deals, each weighted by its probability. Rounded to whole units. */
  weightedValue: number;
  /** Closed and won. Not a forecast at all — it happened. */
  wonValue: number;
  /** How many open deals carry a probability a person set. */
  judged: number;
  /** How many are standing on the stage default. */
  assumed: number;
  /**
   * The share of the weighted value resting on stage defaults, 0 to 1.
   *
   * One is a forecast nobody has looked at; zero is one where every deal has been judged.
   */
  assumedShare: number;
}

export const probabilityOf = (deal: ForecastDeal) =>
  deal.probabilityUserDefined ?? DEFAULT_STAGE_PROBABILITY[deal.stage];

export function forecast(deals: readonly ForecastDeal[]): Forecast {
  const open = deals.filter((d) => !isClosed(d.stage));
  const wonValue = deals.filter((d) => d.stage === "won").reduce((s, d) => s + d.value, 0);
  const openValue = open.reduce((s, d) => s + d.value, 0);

  let weighted = 0;
  let assumedWeighted = 0;
  let judged = 0;
  let assumed = 0;
  for (const deal of open) {
    const part = deal.value * probabilityOf(deal);
    weighted += part;
    if (deal.probabilityUserDefined === null) {
      assumed += 1;
      assumedWeighted += part;
    } else {
      judged += 1;
    }
  }

  return {
    openValue,
    weightedValue: Math.round(weighted),
    wonValue,
    judged,
    assumed,
    // Of the forecast, not of the deals: one judged £50k deal outweighs ten assumed £100 ones.
    assumedShare: weighted > 0 ? assumedWeighted / weighted : 0,
  };
}

/**
 * Whether the forecast is worth reading as one.
 *
 * Under a handful of deals, or with nearly all of it resting on defaults, the number is the
 * stage counts in money's clothing. Saying so beats printing it as though it were earned.
 */
export function forecastIsThin(f: Forecast): boolean {
  return f.judged + f.assumed < 3 || f.assumedShare > 0.8;
}
