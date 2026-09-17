import { describe, expect, it } from "vitest";
import { daysBetween, iso, localDate, sameLocalDay } from "./rows";

describe("time helpers", () => {
  it("uses the operator's calendar day, not UTC", () => {
    // 23:30 UTC on 17 Sep is 00:30 on 18 Sep in London (BST)
    expect(localDate(new Date("2026-09-17T23:30:00Z"))).toBe("2026-09-18");
    expect(localDate(new Date("2026-09-17T23:30:00Z"), "UTC")).toBe("2026-09-17");
  });

  it("compares local days and tolerates missing dates", () => {
    const now = new Date("2026-09-18T08:00:00Z");
    expect(sameLocalDay(new Date("2026-09-17T23:30:00Z"), now)).toBe(true);
    expect(sameLocalDay(new Date("2026-09-17T22:30:00Z"), now)).toBe(false);
    expect(sameLocalDay(null, now)).toBe(false);
  });

  it("formats and diffs dates", () => {
    expect(iso(null)).toBe("");
    expect(iso(new Date("2026-09-17T00:00:00Z"))).toBe("2026-09-17T00:00:00.000Z");
    expect(daysBetween(new Date("2026-09-17"), new Date("2026-11-16"))).toBe(60);
  });
});
