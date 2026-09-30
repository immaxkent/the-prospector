import { describe, expect, it } from "vitest";
import { fixtureEndeavours, fixtureRuns, fixtureThreads } from "./fixtures";
import { dailyActivity, isQuiet } from "./chart-series";
import { agentClock } from "./agent-clock";

/**
 * The fixtures are read through windows — the last fortnight, the last day — so they go
 * wrong by sitting still. On 2026-09-30 the activity chart's window cleared, the endeavour
 * said nothing had gone out in a fortnight, and a suite that had passed for two weeks went
 * red on a screen nobody had touched.
 *
 * These run against the real clock on purpose. A test that pins a date would have passed
 * on that morning too.
 */
describe("the demo fixtures, read today", () => {
  it("still have something in the fortnight the activity chart draws", () => {
    expect(isQuiet(dailyActivity(fixtureThreads, new Date()))).toBe(false);
  });

  it("still show an agent that has run recently, rather than one that looks abandoned", () => {
    // "Not run in over a day" is a warning. A demo should not open on one.
    expect(agentClock(fixtureRuns, new Date()).pulse).not.toBe("stalled");
  });

  it("still have every deadline ahead of them, because a target you have already missed is not a target", () => {
    expect(fixtureEndeavours.length).toBeGreaterThan(0);
    for (const endeavour of fixtureEndeavours) {
      expect(new Date(endeavour.deadline).getTime()).toBeGreaterThan(Date.now());
    }
  });
});
