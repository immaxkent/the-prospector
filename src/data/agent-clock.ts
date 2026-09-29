/**
 * When the agent last ran, and when it is due next.
 *
 * Both are read off what actually happened rather than off a schedule that may or may not
 * have fired: the last run is the last run, and "due" is the next time the scheduler will
 * pick this endeavour up. An endeavour whose run failed is still due at the usual hour, so
 * the two questions stay separate.
 */
import type { AgentRun } from "./types";

/** The hour the worker starts queueing the day's runs, in the operator's timezone. */
export const DAILY_RUN_HOUR = 7;
export const OPERATOR_TIMEZONE = "Europe/London";

export type AgentPulse = "running" | "idle" | "stalled" | "never";

export interface AgentClock {
  pulse: AgentPulse;
  /** The phase a running run is on. Null when nothing is running. */
  phase: string | null;
  lastRunAt: Date | null;
  /** Whether the last completed run failed, which "last ran" alone would not say. */
  lastFailed: boolean;
  nextDueAt: Date;
}

const hourIn = (at: Date, timeZone: string) =>
  Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone }).format(at));

/**
 * The next time the scheduler will look at this endeavour.
 *
 * Before the hour, today. After it, tomorrow — the day's run has already been queued, so
 * the next opportunity is the next day, whatever became of it.
 */
export function nextDue(now: Date, hour = DAILY_RUN_HOUR, timeZone = OPERATOR_TIMEZONE): Date {
  const due = new Date(now);
  due.setUTCHours(hour, 0, 0, 0);
  // The hour is local, so compare in local terms rather than trusting a UTC field.
  if (hourIn(now, timeZone) >= hour) due.setUTCDate(due.getUTCDate() + 1);
  return due;
}

export function agentClock(runs: readonly AgentRun[], now: Date, hour = DAILY_RUN_HOUR): AgentClock {
  // Newest first, whatever order they arrive in.
  const ordered = [...runs].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const running = ordered.find((r) => r.state === "RUNNING");
  const lastFinished = ordered.find((r) => r.state !== "RUNNING");
  const nextDueAt = nextDue(now, hour);

  if (running) {
    return { pulse: "running", phase: running.phase, lastRunAt: new Date(running.startedAt), lastFailed: false, nextDueAt };
  }
  if (!lastFinished) {
    return { pulse: "never", phase: null, lastRunAt: null, lastFailed: false, nextDueAt };
  }

  const lastRunAt = new Date(lastFinished.startedAt);
  // A day and a half: long enough that a late run is not called stalled, short enough that
  // a missed day is.
  const stalled = now.getTime() - lastRunAt.getTime() > 36 * 3_600_000;
  return {
    pulse: stalled ? "stalled" : "idle",
    phase: null,
    lastRunAt,
    lastFailed: lastFinished.state === "FAILED",
    nextDueAt,
  };
}

/** "4m ago", "3h ago", "2d ago". Past a week, the reader wants a date, not a count. */
export function ago(from: Date, now: Date): string {
  const minutes = Math.floor((now.getTime() - from.getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days <= 7) return `${days}d ago`;
  return from.toISOString().slice(0, 10);
}

/** "in 12m", "in 5h". Never a negative: something due in the past is due now. */
export function until(to: Date, now: Date): string {
  const minutes = Math.ceil((to.getTime() - now.getTime()) / 60_000);
  if (minutes <= 0) return "due now";
  if (minutes < 60) return `in ${minutes}m`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `in ${hours}h` : `in ${Math.round(hours / 24)}d`;
}
