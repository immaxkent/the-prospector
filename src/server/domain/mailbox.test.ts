import { describe, expect, it } from "vitest";
import {
  DEFAULT_MAILBOX_LIMITS,
  allocateSends,
  checkAliasRequest,
  effectiveDailyCap,
  isQuietHour,
  mailboxLimitsSchema,
  remainingSends,
  type MailboxAlias,
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

describe("alias requests", () => {
  const mailbox = { address: "max@goodpaper.io", status: "connected", aliases: [] as MailboxAlias[] };
  const request = { address: "partnerships@immaxkent.xyz", displayName: "Max Kent" };

  it("accepts an address on another domain the Workspace holds", () => {
    expect(checkAliasRequest(mailbox, request)).toEqual({
      ok: true,
      address: "partnerships@immaxkent.xyz",
      displayName: "Max Kent",
    });
  });

  it("normalises case", () => {
    expect(checkAliasRequest(mailbox, { ...request, address: "  Partnerships@ImMaxKent.XYZ " })).toMatchObject({
      ok: true,
      address: "partnerships@immaxkent.xyz",
    });
  });

  it("refuses a local part Google would refuse", () => {
    for (const local of ["", "has space", ".leading", "trailing.", "two..dots", "a".repeat(65), "quote'd"]) {
      expect(checkAliasRequest(mailbox, { ...request, address: `${local}@immaxkent.xyz` })).toMatchObject({ ok: false });
    }
  });

  it("refuses something that is not a whole address", () => {
    for (const address of ["partnerships", "@immaxkent.xyz", "a@b@c.com", "partnerships@", "partnerships@nodot"]) {
      expect(checkAliasRequest(mailbox, { ...request, address })).toMatchObject({ ok: false });
    }
  });

  it("explains that gmail.com cannot hold an alias", () => {
    expect(checkAliasRequest(mailbox, { ...request, address: "someone@gmail.com" })).toMatchObject({
      ok: false,
      reason: expect.stringContaining("gmail.com"),
    });
  });

  it("refuses the account's own address and one it already sends as", () => {
    expect(checkAliasRequest(mailbox, { ...request, address: "max@goodpaper.io" })).toMatchObject({
      ok: false,
      reason: "that is the account's own address",
    });
    const withAlias = {
      ...mailbox,
      aliases: [{ address: "Partnerships@immaxkent.xyz", displayName: "Max", createdAt: "2026-09-18T00:00:00Z" }],
    };
    expect(checkAliasRequest(withAlias, request)).toMatchObject({ ok: false, reason: expect.stringContaining("already") });
  });

  it("will not add an alias to a mailbox that cannot send", () => {
    expect(checkAliasRequest({ ...mailbox, status: "needs_reauth" }, request)).toMatchObject({
      ok: false,
      reason: expect.stringContaining("reconnect"),
    });
  });

  it("requires a display name recipients will see", () => {
    expect(checkAliasRequest(mailbox, { ...request, displayName: "  " })).toMatchObject({ ok: false });
    expect(checkAliasRequest(mailbox, { ...request, displayName: "n".repeat(81) })).toMatchObject({ ok: false });
  });
});
