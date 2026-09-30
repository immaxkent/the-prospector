import { describe, expect, it } from "vitest";
import type { PipelineStage } from "./pipeline";
import {
  ACTIVE_GOAL_RANGE,
  ACTIVE_STAGES,
  DEFAULT_PROSPECTING,
  PENDING_CAP_RANGE,
  PENDING_STAGES,
  countProspecting,
  isActive,
  isPending,
  normaliseProspecting,
  prospectingHalt,
  type CountableProspect,
  type ProspectingCount,
} from "./prospecting";

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

describe("normaliseProspecting", () => {
  it("falls back to the defaults rather than taking the endeavour down", () => {
    // Settings written by an older version, or by hand, must not throw on the way in.
    expect(normaliseProspecting(null)).toEqual(DEFAULT_PROSPECTING);
    expect(normaliseProspecting({ maximumPending: Number.NaN })).toEqual(DEFAULT_PROSPECTING);
    expect(normaliseProspecting({ activeGoal: "twenty" as unknown as number }).activeGoal).toBe(20);
  });

  it("holds a stored value to its bounds and rounds a fractional one", () => {
    expect(normaliseProspecting({ maximumPending: 9000 }).maximumPending).toBe(PENDING_CAP_RANGE.max);
    expect(normaliseProspecting({ maximumPending: 0 }).maximumPending).toBe(PENDING_CAP_RANGE.min);
    expect(normaliseProspecting({ activeGoal: 12.4 }).activeGoal).toBe(12);
    expect(normaliseProspecting({ activeGoal: 9000 }).activeGoal).toBe(ACTIVE_GOAL_RANGE.max);
  });

  it("treats anything but a true as not paused, so a stray value cannot stop the engine", () => {
    expect(normaliseProspecting({}).paused).toBe(false);
    expect(normaliseProspecting({ paused: "yes" as unknown as boolean }).paused).toBe(false);
    expect(normaliseProspecting({ paused: true }).paused).toBe(true);
  });

  it("keeps what the operator actually set", () => {
    expect(normaliseProspecting({ maximumPending: 30, activeGoal: 8, paused: true })).toEqual({
      maximumPending: 30,
      activeGoal: 8,
      paused: true,
    });
  });
});

describe("prospectingHalt", () => {
  const count = (over: Partial<ProspectingCount> = {}): ProspectingCount => ({
    pending: 0,
    active: 0,
    pendingBySegment: new Map(),
    ...over,
  });

  it("runs when there is room and the goal is not met", () => {
    expect(prospectingHalt(count({ pending: 10, active: 3 }), DEFAULT_PROSPECTING)).toBeNull();
  });

  it("stops on the operator's own switch, whatever the numbers say", () => {
    expect(prospectingHalt(count(), { ...DEFAULT_PROSPECTING, paused: true })).toBe("paused");
  });

  it("stops when the buffer is full, and says so", () => {
    expect(prospectingHalt(count({ pending: 50 }), DEFAULT_PROSPECTING)).toBe("buffer_full");
    expect(prospectingHalt(count({ pending: 51 }), DEFAULT_PROSPECTING)).toBe("buffer_full");
  });

  it("reports a met goal as a met goal, not as a full queue", () => {
    // Both are true when the pipeline is healthy. Calling it a full queue would send the
    // operator off to clear work that is doing exactly what it should.
    expect(prospectingHalt(count({ pending: 50, active: 20 }), DEFAULT_PROSPECTING)).toBe("goal_met");
  });
});
