import { describe, expect, it } from "vitest";
import type { PipelineStage } from "./pipeline";
import { ACTIVE_STAGES, PENDING_STAGES, countProspecting, isActive, isPending, type CountableProspect } from "./prospecting";

const p = (stage: PipelineStage, over: Partial<CountableProspect> = {}): CountableProspect => ({
  stage,
  reviewStatus: "qualified",
  segmentId: "seg_1",
  ...over,
});

describe("what counts as pending", () => {
  it("includes a prospect nobody has released yet", () => {
    // The whole point of the cap: research that nobody acts on still cost money and still
    // sits in front of the operator. Leaving it out would let discovery run without limit.
    expect(isPending(p("discovered"))).toBe(true);
    expect(isPending(p("researched"))).toBe(true);
    expect(isPending(p("qualified"))).toBe(true);
    expect(isPending(p("contacted"))).toBe(true);
  });

  it("stops at the reply, because an answered prospect is a conversation not a queue item", () => {
    expect(isPending(p("replied"))).toBe(false);
    expect(isActive(p("replied"))).toBe(true);
  });

  it("frees the slot once the operator rejects it, wherever it had got to", () => {
    // Rejection sits beside the stage rather than in it, so a stage test alone keeps counting it.
    expect(isPending(p("contacted", { reviewStatus: "rejected" }))).toBe(false);
    expect(isActive(p("replied", { reviewStatus: "rejected" }))).toBe(false);
  });

  it("still counts one the model sent to review, because that is waiting on the operator", () => {
    expect(isPending(p("qualified", { reviewStatus: "needs_review" }))).toBe(true);
  });

  it("frees the slot for anything finished or set aside", () => {
    for (const stage of ["won", "lost", "nurture"] as const) {
      expect(isPending(p(stage))).toBe(false);
      expect(isActive(p(stage))).toBe(false);
    }
  });

  it("does not hold an active slot for a closed deal", () => {
    // A good outcome should not read as a busy one, or winning work stops you finding more.
    expect(isActive(p("won"))).toBe(false);
  });

  it("puts every stage in at most one population", () => {
    const overlap = PENDING_STAGES.filter((s) => ACTIVE_STAGES.includes(s));
    expect(overlap).toEqual([]);
  });
});

describe("countProspecting", () => {
  it("counts both populations and splits pending by segment", () => {
    const count = countProspecting([
      p("discovered", { segmentId: "a" }),
      p("qualified", { segmentId: "a" }),
      p("contacted", { segmentId: "b" }),
      p("replied", { segmentId: "a" }),
      p("meeting", { segmentId: "b" }),
      p("won", { segmentId: "a" }),
      p("researched", { segmentId: "b", reviewStatus: "rejected" }),
    ]);

    expect(count.pending).toBe(3);
    expect(count.active).toBe(2);
    expect([...count.pendingBySegment]).toEqual([
      ["a", 2],
      ["b", 1],
    ]);
  });

  it("counts a prospect whose segment is gone in the total and nowhere else", () => {
    // It still occupies a slot. Inventing a bucket would hand a retired segment an allowance.
    const count = countProspecting([p("qualified", { segmentId: null }), p("qualified", { segmentId: "a" })]);
    expect(count.pending).toBe(2);
    expect([...count.pendingBySegment]).toEqual([["a", 1]]);
  });

  it("is zero on nothing, rather than undefined", () => {
    expect(countProspecting([])).toEqual({ pending: 0, active: 0, pendingBySegment: new Map() });
  });
});
