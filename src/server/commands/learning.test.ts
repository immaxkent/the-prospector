import { describe, expect, it } from "vitest";
import type { PerformanceCut } from "../read/performance";
import { OBJECTION_SIGNAL_THRESHOLD, proposeInsights } from "./learning";

const cut = (over: Partial<PerformanceCut> & { label: string }): PerformanceCut => ({
  dimension: "segment",
  sent: 0,
  replies: 0,
  positiveReplies: 0,
  meetings: 0,
  wins: 0,
  revenue: 0,
  ...over,
});

const strong = cut({ label: "Launch-stage protocols", sent: 22, replies: 6, positiveReplies: 5, wins: 1, revenue: 750 });
const weak = cut({ label: "General protocols", sent: 41, replies: 2, positiveReplies: 1 });

describe("proposeInsights", () => {
  it("says nothing at all from a small sample", () => {
    expect(proposeInsights([cut({ label: "A", sent: 5, positiveReplies: 3 }), cut({ label: "B", sent: 4 })], [])).toEqual([]);
  });

  it("reports the overall reply rate with its denominator", () => {
    const [observation] = proposeInsights([strong, weak], []);
    expect(observation).toMatchObject({ type: "observation", evidence: { sent: 63, positiveReplies: 6 } });
    expect(observation!.statement).toContain("6/63");
  });

  it("recommends the better segment with both fractions", () => {
    const recommendation = proposeInsights([strong, weak], []).find((i) => i.type === "recommendation")!;
    expect(recommendation.statement).toContain("5/22");
    expect(recommendation.statement).toContain("1/41");
    expect(recommendation.statement).toContain("Launch-stage protocols");
    expect(recommendation.evidence).toMatchObject({ dimension: "segment", best: { sent: 22 }, worst: { sent: 41 } });
  });

  it("stays quiet when the difference is not big enough to act on", () => {
    const close = [cut({ label: "A", sent: 40, positiveReplies: 6 }), cut({ label: "B", sent: 40, positiveReplies: 5 })];
    expect(proposeInsights(close, []).some((i) => i.type === "recommendation")).toBe(false);
  });

  it("ignores a label whose own sample is too small, even beside a big one", () => {
    const lopsided = [strong, cut({ label: "Tiny", sent: 3, positiveReplies: 0 })];
    expect(proposeInsights(lopsided, []).some((i) => i.type === "recommendation")).toBe(false);
  });

  it("compares message versions and triggers too", () => {
    const versions = [
      cut({ dimension: "message_version", label: "v2", sent: 20, positiveReplies: 5 }),
      cut({ dimension: "message_version", label: "v1", sent: 20, positiveReplies: 1 }),
    ];
    const recommendation = proposeInsights(versions, []).find((i) => i.type === "recommendation")!;
    expect(recommendation.statement).toContain('message version "v2"');
  });

  it("raises a repeated objection as a signal, and ignores a one-off", () => {
    const objections = [
      { label: "We already have an auditor", count: OBJECTION_SIGNAL_THRESHOLD, example: "We already have an auditor" },
      { label: "Too expensive", count: 1, example: "Too expensive" },
    ];
    const signals = proposeInsights([], objections).filter((i) => i.type === "signal");
    expect(signals).toHaveLength(1);
    expect(signals[0]!.statement).toContain("3 times");
  });
});
