import { describe, expect, it } from "vitest";
import { DEFAULT_FOLLOWUP_DAYS, decideFollowUp, nextFollowUpAt, sequenceFinished } from "./followup";

const NOW = new Date("2026-09-20T09:00:00Z");
const sentOn = (days: number) => new Date(NOW.getTime() - days * 86_400_000);

const input = (over: Partial<Parameters<typeof decideFollowUp>[0]> = {}) => ({
  stage: "contacted",
  reviewStatus: "qualified",
  lastOutboundAt: sentOn(4),
  lastInboundAt: null,
  followUpsSoFar: 0,
  now: NOW,
  ...over,
});

describe("nextFollowUpAt", () => {
  it("spaces follow-ups by the cadence and then stops", () => {
    const base = new Date("2026-09-17T09:00:00Z");
    expect(nextFollowUpAt(base, 0)).toEqual(new Date("2026-09-20T09:00:00Z"));
    expect(nextFollowUpAt(base, 1)).toEqual(new Date("2026-09-24T09:00:00Z"));
    expect(nextFollowUpAt(base, 2)).toEqual(new Date("2026-10-01T09:00:00Z"));
    expect(nextFollowUpAt(base, 3)).toBeNull();
  });
});

describe("decideFollowUp", () => {
  it("is due once the cadence gap has passed", () => {
    expect(decideFollowUp(input())).toEqual({ due: true, attempt: 1 });
  });

  it("waits while it is too soon, and says when it will be due", () => {
    const result = decideFollowUp(input({ lastOutboundAt: sentOn(1) }));
    expect(result).toMatchObject({ due: false, reason: "too_soon" });
    expect(result.due === false && result.nextDueAt).toEqual(new Date("2026-09-22T09:00:00Z"));
  });

  it("stops the moment they reply", () => {
    expect(decideFollowUp(input({ lastInboundAt: sentOn(2) }))).toMatchObject({ due: false, reason: "replied" });
  });

  it("stops for a closed or rejected prospect", () => {
    for (const stage of ["won", "lost", "nurture"]) {
      expect(decideFollowUp(input({ stage }))).toMatchObject({ due: false, reason: "closed" });
    }
    expect(decideFollowUp(input({ reviewStatus: "rejected" }))).toMatchObject({ due: false, reason: "closed" });
  });

  it("does not chase someone who was never contacted", () => {
    expect(decideFollowUp(input({ stage: "qualified" }))).toMatchObject({ due: false, reason: "not_contacted" });
    expect(decideFollowUp(input({ lastOutboundAt: null }))).toMatchObject({ due: false, reason: "none_sent" });
  });

  it("stops when the sequence is spent", () => {
    expect(decideFollowUp(input({ followUpsSoFar: 3, lastOutboundAt: sentOn(30) }))).toMatchObject({
      due: false,
      reason: "sequence_finished",
    });
    expect(sequenceFinished(3)).toBe(true);
    expect(sequenceFinished(2)).toBe(false);
  });

  it("honours a custom cadence", () => {
    expect(decideFollowUp(input({ cadenceDays: [10], lastOutboundAt: sentOn(4) }))).toMatchObject({ due: false, reason: "too_soon" });
    expect(decideFollowUp(input({ cadenceDays: [2] }))).toEqual({ due: true, attempt: 1 });
    expect(DEFAULT_FOLLOWUP_DAYS).toEqual([3, 7, 14]);
  });
});
