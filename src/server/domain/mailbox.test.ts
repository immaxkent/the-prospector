import { describe, expect, it } from "vitest";
import {
  DEFAULT_MAILBOX_LIMITS,
  allocateSends,
  effectiveDailyCap,
  isQuietHour,
  mailboxLimitsSchema,
  remainingSends,
  type MailboxLimits,
} from "./mailbox";

const warming: MailboxLimits = {
  ...DEFAULT_MAILBOX_LIMITS,
  dailyCap: 30,
  weeklyCap: 100,
  warmup: { startedOn: "2026-09-10", startCap: 5, incrementPerDay: 2 },
};

describe("limits schema", () => {
  it("accepts the defaults and rejects a zero cap", () => {
    expect(mailboxLimitsSchema.safeParse(DEFAULT_MAILBOX_LIMITS).success).toBe(true);
    expect(mailboxLimitsSchema.safeParse({ ...DEFAULT_MAILBOX_LIMITS, dailyCap: 0 }).success).toBe(false);
  });
});

describe("effectiveDailyCap", () => {
  it("ramps during warm-up and never exceeds the configured cap", () => {
    expect(effectiveDailyCap(warming, "2026-09-10")).toBe(5);
    expect(effectiveDailyCap(warming, "2026-09-17")).toBe(19);
    expect(effectiveDailyCap(warming, "2026-10-30")).toBe(30);
  });

  it("treats dates before the warm-up start as day zero", () => {
    expect(effectiveDailyCap(warming, "2026-09-01")).toBe(5);
  });

  it("uses the daily cap without warm-up", () => {
    expect(effectiveDailyCap(DEFAULT_MAILBOX_LIMITS, "2026-09-17")).toBe(30);
  });
});

describe("remainingSends", () => {
  it("is limited by whichever of daily or weekly is tighter", () => {
    expect(remainingSends(warming, { sentToday: 4, sentLast7Days: 10 }, "2026-09-17")).toBe(15);
    expect(remainingSends(warming, { sentToday: 4, sentLast7Days: 95 }, "2026-09-17")).toBe(5);
  });

  it("never goes negative", () => {
    expect(remainingSends(warming, { sentToday: 50, sentLast7Days: 0 }, "2026-09-17")).toBe(0);
  });
});

describe("isQuietHour", () => {
  const limits = { ...DEFAULT_MAILBOX_LIMITS, timezone: "Europe/London" };

  it("wraps overnight in the mailbox timezone", () => {
    // 19:30 UTC is 20:30 BST
    expect(isQuietHour(limits, new Date("2026-09-17T19:30:00Z"))).toBe(true);
    expect(isQuietHour(limits, new Date("2026-09-17T05:30:00Z"))).toBe(true);
    expect(isQuietHour(limits, new Date("2026-09-17T06:30:00Z"))).toBe(false);
    expect(isQuietHour(limits, new Date("2026-09-17T12:00:00Z"))).toBe(false);
  });

  it("handles same-day windows and disabled windows", () => {
    expect(isQuietHour({ ...limits, quietHours: { start: 12, end: 14 } }, new Date("2026-09-17T12:30:00Z"))).toBe(true);
    expect(isQuietHour({ ...limits, quietHours: { start: 9, end: 9 } }, new Date("2026-09-17T08:30:00Z"))).toBe(false);
  });
});

describe("allocateSends", () => {
  it("shares capacity evenly between equal priorities", () => {
    const granted = allocateSends(9, [
      { endeavourId: "a", requested: 10, priority: 1 },
      { endeavourId: "b", requested: 10, priority: 1 },
    ]);
    expect([granted.get("a"), granted.get("b")]).toEqual([5, 4]);
  });

  it("serves higher priority first and never grants beyond the request", () => {
    const granted = allocateSends(12, [
      { endeavourId: "low", requested: 10, priority: 2 },
      { endeavourId: "high", requested: 8, priority: 1 },
    ]);
    expect(granted.get("high")).toBe(8);
    expect(granted.get("low")).toBe(4);
  });

  it("two endeavours on one mailbox cannot exceed its combined cap", () => {
    const capacity = remainingSends(warming, { sentToday: 0, sentLast7Days: 0 }, "2026-09-17");
    const granted = allocateSends(capacity, [
      { endeavourId: "solidity", requested: 18, priority: 1 },
      { endeavourId: "decastream", requested: 18, priority: 1 },
    ]);
    expect([...granted.values()].reduce((a, b) => a + b, 0)).toBe(19);
  });

  it("grants nothing with zero or negative capacity", () => {
    const granted = allocateSends(-3, [{ endeavourId: "a", requested: 5, priority: 1 }]);
    expect(granted.get("a")).toBe(0);
  });
});
