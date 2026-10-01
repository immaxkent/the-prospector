/**
 * When the digest and the review arrive.
 *
 * Per endeavour, not per server. A morning digest that lands at three in the morning for
 * the person reading it is not a morning digest, and an operator running an endeavour for a
 * client in another country should not have to do the arithmetic themselves.
 *
 * The timezone is the endeavour's own rather than the mailbox's: the mailbox's timezone is
 * about when it is polite to send to a stranger, and this is about when it is useful to
 * interrupt the operator. They are frequently not the same.
 */

/** Monday, because a week's review read on a Monday morning is a plan rather than a post-mortem. */
export const DEFAULT_REVIEW_WEEKDAY = 1;
export const DEFAULT_DIGEST_HOUR = 7;
export const DEFAULT_REVIEW_HOUR = 8;
export const DEFAULT_REPORT_TIMEZONE = "Europe/London";

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

export interface ReportingSchedule {
  /** Local hour the daily digest goes out, 0-23. */
  digestHour: number;
  /** 0 = Sunday, matching Date#getDay so nothing has to be translated at the call site. */
  reviewWeekday: number;
  reviewHour: number;
  /** IANA name. Everything above is local to it. */
  timezone: string;
}

export const DEFAULT_REPORTING: ReportingSchedule = {
  digestHour: DEFAULT_DIGEST_HOUR,
  reviewWeekday: DEFAULT_REVIEW_WEEKDAY,
  reviewHour: DEFAULT_REVIEW_HOUR,
  timezone: DEFAULT_REPORT_TIMEZONE,
};

/** A name Intl actually knows. An unknown one would throw at send time, which is far too late. */
export function isKnownTimezone(name: string): boolean {
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: name });
    return true;
  } catch {
    return false;
  }
}

const hourOr = (value: unknown, fallback: number) => {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(23, Math.max(0, Math.round(value)));
};

/** Reading storage, which must never throw: an unreadable setting falls back to the default. */
export function normaliseReporting(stored: Partial<ReportingSchedule> | null | undefined): ReportingSchedule {
  const weekday = stored?.reviewWeekday;
  return {
    digestHour: hourOr(stored?.digestHour, DEFAULT_DIGEST_HOUR),
    reviewWeekday:
      typeof weekday === "number" && Number.isFinite(weekday) ? Math.min(6, Math.max(0, Math.round(weekday))) : DEFAULT_REVIEW_WEEKDAY,
    reviewHour: hourOr(stored?.reviewHour, DEFAULT_REVIEW_HOUR),
    timezone: typeof stored?.timezone === "string" && isKnownTimezone(stored.timezone) ? stored.timezone : DEFAULT_REPORT_TIMEZONE,
  };
}

/** What is wrong with what the operator chose, in their words. Null when nothing is. */
export function reportingProblem(input: ReportingSchedule): string | null {
  const hour = (n: number) => Number.isInteger(n) && n >= 0 && n <= 23;
  if (!hour(input.digestHour) || !hour(input.reviewHour)) return "an hour must be a whole number between 0 and 23";
  if (!Number.isInteger(input.reviewWeekday) || input.reviewWeekday < 0 || input.reviewWeekday > 6) {
    return "pick a day of the week for the review";
  }
  if (!isKnownTimezone(input.timezone)) return `${input.timezone} is not a timezone this server knows`;
  return null;
}

/** The local hour and weekday at an instant, in the endeavour's own timezone. */
export function localMoment(at: Date, timezone: string): { hour: number; weekday: number; date: string } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "numeric",
    hourCycle: "h23",
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return {
    hour: Number(get("hour")),
    weekday: weekdays.indexOf(get("weekday")),
    date: `${get("year")}-${get("month")}-${get("day")}`,
  };
}

/**
 * Whether a report is due now, given when one last went out.
 *
 * "At or after the hour, and not already sent for this period" rather than "exactly at the
 * hour": the worker ticks on its own schedule and a box that was asleep at seven should
 * still send at ten past, rather than skipping the day entirely.
 */
export function digestDue(now: Date, schedule: ReportingSchedule, lastSentAt: Date | null): boolean {
  const here = localMoment(now, schedule.timezone);
  if (here.hour < schedule.digestHour) return false;
  if (!lastSentAt) return true;
  return localMoment(lastSentAt, schedule.timezone).date !== here.date;
}

export function reviewDue(now: Date, schedule: ReportingSchedule, lastSentAt: Date | null): boolean {
  const here = localMoment(now, schedule.timezone);
  if (here.weekday !== schedule.reviewWeekday || here.hour < schedule.reviewHour) return false;
  if (!lastSentAt) return true;
  // A week apart rather than a different date: the review goes out once on its day, and a
  // box restarted an hour later must not send a second one.
  return localMoment(lastSentAt, schedule.timezone).date !== here.date;
}
