import { describe, expect, it } from "vitest";
import {
  DEFAULT_REPORTING,
  digestDue,
  isKnownTimezone,
  localMoment,
  normaliseReporting,
  reportingProblem,
  reviewDue,
  type ReportingSchedule,
} from "./reporting-schedule";

const schedule = (over: Partial<ReportingSchedule> = {}): ReportingSchedule => ({ ...DEFAULT_REPORTING, ...over });

describe("normaliseReporting", () => {
  it("falls back rather than throwing on anything unreadable", () => {
    expect(normaliseReporting(null)).toEqual(DEFAULT_REPORTING);
    expect(normaliseReporting({ digestHour: Number.NaN })).toEqual(DEFAULT_REPORTING);
    expect(normaliseReporting({ timezone: "Mars/Olympus" }).timezone).toBe(DEFAULT_REPORTING.timezone);
  });

  it("holds hours and weekdays to their range", () => {
    expect(normaliseReporting({ digestHour: 99 }).digestHour).toBe(23);
    expect(normaliseReporting({ reviewHour: -4 }).reviewHour).toBe(0);
    expect(normaliseReporting({ reviewWeekday: 9 }).reviewWeekday).toBe(6);
  });

  it("keeps a timezone the server actually knows", () => {
    expect(normaliseReporting({ timezone: "America/New_York" }).timezone).toBe("America/New_York");
    expect(isKnownTimezone("Australia/Sydney")).toBe(true);
    expect(isKnownTimezone("Nowhere/Nothing")).toBe(false);
  });
});

describe("reportingProblem", () => {
  it("passes a sensible schedule", () => {
    expect(reportingProblem(schedule())).toBeNull();
  });

  it("names what is wrong, rather than correcting it behind the operator", () => {
    expect(reportingProblem(schedule({ digestHour: 24 }))).toMatch(/between 0 and 23/);
    expect(reportingProblem(schedule({ reviewWeekday: 7 }))).toMatch(/day of the week/);
    expect(reportingProblem(schedule({ timezone: "Nowhere/Nothing" }))).toMatch(/not a timezone/);
  });
});

describe("localMoment", () => {
  it("reads the hour where the operator is, not where the server is", () => {
    // 23:30 UTC on a Sunday is already Monday morning in Sydney.
    const at = new Date("2026-10-04T23:30:00Z");
    expect(localMoment(at, "UTC")).toMatchObject({ hour: 23, weekday: 0, date: "2026-10-04" });
    expect(localMoment(at, "Australia/Sydney")).toMatchObject({ hour: 10, weekday: 1, date: "2026-10-05" });
  });
});

describe("digestDue", () => {
  const morning = new Date("2026-10-05T07:30:00Z"); // 08:30 in London

  it("is due once the hour has come round and nothing has gone out", () => {
    expect(digestDue(morning, schedule({ digestHour: 7 }), null)).toBe(true);
  });

  it("is not due before the hour", () => {
    expect(digestDue(new Date("2026-10-05T03:00:00Z"), schedule({ digestHour: 7 }), null)).toBe(false);
  });

  it("still goes out late rather than skipping the day", () => {
    // The worker ticks on its own schedule, and a box asleep at seven should still send at ten past.
    expect(digestDue(new Date("2026-10-05T20:00:00Z"), schedule({ digestHour: 7 }), null)).toBe(true);
  });

  it("goes out once a day, however often it is asked", () => {
    const sent = new Date("2026-10-05T06:05:00Z");
    expect(digestDue(morning, schedule({ digestHour: 7 }), sent)).toBe(false);
    expect(digestDue(new Date("2026-10-06T07:30:00Z"), schedule({ digestHour: 7 }), sent)).toBe(true);
  });

  it("measures the day where the operator is", () => {
    // Sent 23:00 UTC Sunday, asked 00:30 UTC Monday. In Sydney both are Monday, so the
    // second ask is the same day and must not send again.
    const sent = new Date("2026-10-04T23:00:00Z");
    const asked = new Date("2026-10-05T00:30:00Z");
    expect(digestDue(asked, schedule({ digestHour: 7, timezone: "Australia/Sydney" }), sent)).toBe(false);
  });
});

describe("reviewDue", () => {
  it("is due on its day, once the hour has come round", () => {
    // 2026-10-05 is a Monday.
    expect(reviewDue(new Date("2026-10-05T08:00:00Z"), schedule({ reviewWeekday: 1, reviewHour: 8 }), null)).toBe(true);
  });

  it("is not due on another day, however late in it", () => {
    expect(reviewDue(new Date("2026-10-06T23:00:00Z"), schedule({ reviewWeekday: 1, reviewHour: 8 }), null)).toBe(false);
  });

  it("goes out once, so a restart an hour later does not send a second", () => {
    const sent = new Date("2026-10-05T08:05:00Z");
    expect(reviewDue(new Date("2026-10-05T09:00:00Z"), schedule({ reviewWeekday: 1, reviewHour: 8 }), sent)).toBe(false);
    expect(reviewDue(new Date("2026-10-12T09:00:00Z"), schedule({ reviewWeekday: 1, reviewHour: 8 }), sent)).toBe(true);
  });

  it("uses the operator's weekday, not the server's", () => {
    // 23:30 UTC Sunday is Monday morning in Sydney, so a Monday review is due there.
    const at = new Date("2026-10-04T23:30:00Z");
    expect(reviewDue(at, schedule({ reviewWeekday: 1, reviewHour: 8, timezone: "Australia/Sydney" }), null)).toBe(true);
    expect(reviewDue(at, schedule({ reviewWeekday: 1, reviewHour: 8, timezone: "Europe/London" }), null)).toBe(false);
  });
});
