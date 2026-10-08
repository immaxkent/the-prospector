import { describe, expect, it } from "vitest";
import { forecast, forecastIsThin, isClosed, probabilityOf, type ForecastDeal } from "./forecast";

const deal = (over: Partial<ForecastDeal> = {}): ForecastDeal =>
  ({ stage: "proposal", value: 1000, probabilityUserDefined: null, ...over });

describe("probabilityOf", () => {
  it("takes what the operator said", () => {
    expect(probabilityOf(deal({ probabilityUserDefined: 0.9 }))).toBe(0.9);
  });

  it("stands the stage default in when nobody has said", () => {
    expect(probabilityOf(deal({ stage: "proposal" }))).toBe(0.6);
    expect(probabilityOf(deal({ stage: "contacted" }))).toBe(0.1);
  });

  it("takes a zero the operator set, rather than treating it as nothing said", () => {
    expect(probabilityOf(deal({ probabilityUserDefined: 0 }))).toBe(0);
  });
});

describe("isClosed", () => {
  it("is won and lost, and nothing else — nurture is parked, not closed", () => {
    expect(isClosed("won")).toBe(true);
    expect(isClosed("lost")).toBe(true);
    expect(isClosed("nurture")).toBe(false);
  });
});

describe("forecast", () => {
  it("weights each deal rather than summing face value", () => {
    // A £6,000 proposal and a £6,000 prospect who has not replied are not the same thing.
    const f = forecast([
      deal({ stage: "proposal", value: 6000 }),
      deal({ stage: "contacted", value: 6000 }),
    ]);
    expect(f.openValue).toBe(12_000);
    expect(f.weightedValue).toBe(6000 * 0.6 + 6000 * 0.1);
  });

  it("keeps what was won apart, because it is not a forecast at all", () => {
    const f = forecast([deal({ stage: "won", value: 3000 }), deal({ stage: "proposal", value: 1000 })]);
    expect(f).toMatchObject({ wonValue: 3000, openValue: 1000 });
  });

  it("leaves a lost deal out of everything", () => {
    const f = forecast([deal({ stage: "lost", value: 9000 })]);
    expect(f).toMatchObject({ openValue: 0, weightedValue: 0, wonValue: 0 });
  });

  it("counts what a person judged apart from what is standing on a default", () => {
    const f = forecast([deal({ probabilityUserDefined: 0.5 }), deal({}), deal({})]);
    expect(f).toMatchObject({ judged: 1, assumed: 2 });
  });

  it("measures the assumed share of the forecast, not of the deal count", () => {
    // One judged £50,000 deal outweighs a small assumed one, and the share says so.
    const f = forecast([
      deal({ value: 50_000, probabilityUserDefined: 1 }),
      deal({ stage: "contacted", value: 1000 }),
    ]);
    expect(f.assumedShare).toBeLessThan(0.01);
  });

  it("is entirely assumed when nobody has judged anything", () => {
    expect(forecast([deal({}), deal({})]).assumedShare).toBe(1);
  });

  it("does not divide by nothing", () => {
    expect(forecast([])).toEqual({
      openValue: 0,
      weightedValue: 0,
      wonValue: 0,
      judged: 0,
      assumed: 0,
      assumedShare: 0,
    });
  });

  it("rounds the weighted value, because a forecast in fractions of a penny is noise", () => {
    expect(forecast([deal({ stage: "replied", value: 333 })]).weightedValue).toBe(67);
  });
});

describe("forecastIsThin", () => {
  it("is thin with barely any deals, whatever the number says", () => {
    expect(forecastIsThin(forecast([deal({ probabilityUserDefined: 0.9, value: 100_000 })]))).toBe(true);
  });

  it("is thin when almost all of it rests on defaults", () => {
    expect(forecastIsThin(forecast([deal({}), deal({}), deal({}), deal({})]))).toBe(true);
  });

  it("is not thin once there are a few deals a person has judged", () => {
    const judged = [0.5, 0.6, 0.7].map((p) => deal({ probabilityUserDefined: p }));
    expect(forecastIsThin(forecast(judged))).toBe(false);
  });
});
