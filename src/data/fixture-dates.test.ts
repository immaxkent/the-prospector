import { describe, expect, it } from "vitest";
import { FIXTURE_ANCHOR, fixtureOffsetDays, shiftFixtureDate } from "./fixture-dates";

describe("fixtureOffsetDays", () => {
  it("is nothing on the day the fixtures were written", () => {
    expect(fixtureOffsetDays(new Date("2026-09-16T00:00:00Z"))).toBe(0);
    expect(fixtureOffsetDays(new Date("2026-09-16T23:59:59Z"))).toBe(0);
  });

  it("counts whole days, forwards and backwards", () => {
    expect(fixtureOffsetDays(new Date("2026-09-30T00:05:00Z"))).toBe(14);
    expect(fixtureOffsetDays(new Date("2026-09-14T12:00:00Z"))).toBe(-2);
  });
});

describe("shiftFixtureDate", () => {
  const now = new Date("2026-09-30T00:05:00Z"); // +14 days

  it("keeps the time of day exactly as written", () => {
    // The story says the run went at 07:32:18. It should still say that tomorrow.
    expect(shiftFixtureDate("2026-09-16T07:32:18Z", now)).toBe("2026-09-30T07:32:18Z");
  });

  it("leaves a date with no time as a date with no time", () => {
    expect(shiftFixtureDate("2026-09-16", now)).toBe("2026-09-30");
  });

  it("holds the gaps between fixture dates, which is what the story is", () => {
    const first = shiftFixtureDate("2026-09-07T09:30:00Z", now);
    const last = shiftFixtureDate("2026-09-16T07:32:18Z", now);
    expect(first.slice(0, 10)).toBe("2026-09-21");
    expect(last.slice(0, 10)).toBe("2026-09-30");
  });

  it("moves future dates too, so a close date never falls into the past", () => {
    expect(shiftFixtureDate("2026-12-01", now)).toBe("2026-12-15");
  });

  it("crosses months and years without help", () => {
    expect(shiftFixtureDate("2026-09-16", new Date("2026-12-31T00:00:00Z"))).toBe("2026-12-31");
    expect(shiftFixtureDate("2026-09-16", new Date("2027-03-01T00:00:00Z"))).toBe("2027-03-01");
  });

  it("is a no-op on the anchor day itself", () => {
    expect(shiftFixtureDate("2026-09-12T16:40:00Z", new Date(`${FIXTURE_ANCHOR}T10:00:00Z`))).toBe(
      "2026-09-12T16:40:00Z",
    );
  });
});
