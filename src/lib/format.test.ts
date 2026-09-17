import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clockTime, daysUntil, gbp, num, pct, relative, stamp } from "./format";

describe("gbp", () => {
  it("formats whole pounds", () => {
    expect(gbp(3000)).toBe("£3,000");
  });

  it("compacts thousands and millions with a sign", () => {
    expect(gbp(4250, { compact: true })).toBe("£4.3K");
    expect(gbp(12_000, { compact: true })).toBe("£12K");
    expect(gbp(-1_500_000, { compact: true })).toBe("-£1.5M");
    expect(gbp(750, { compact: true })).toBe("£750");
  });
});

describe("num and pct", () => {
  it("groups thousands", () => {
    expect(num(12345)).toBe("12,345");
  });

  it("renders ratios as percentages", () => {
    expect(pct(0.25)).toBe("25%");
    expect(pct(0.1234, 1)).toBe("12.3%");
  });
});

describe("timestamps", () => {
  it("renders empty values as placeholders", () => {
    expect(clockTime("")).toBe("--:--:--");
    expect(stamp("")).toBe("—");
    expect(relative(null)).toBe("—");
  });

  it("renders UTC clock and stamp", () => {
    expect(clockTime("2026-09-16T07:32:18Z")).toBe("07:32:18");
    expect(stamp("2026-09-16T07:32:18Z")).toBe("2026-09-16 07:32");
  });
});

describe("relative and daysUntil", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-17T12:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("picks minutes, hours or days", () => {
    expect(relative("2026-09-17T11:30:00Z")).toBe("30m");
    expect(relative("2026-09-17T06:00:00Z")).toBe("6h");
    expect(relative("2026-09-14T12:00:00Z")).toBe("3d");
  });

  it("counts days to a deadline", () => {
    expect(daysUntil("2026-11-06T12:00:00Z")).toBe(50);
  });
});
