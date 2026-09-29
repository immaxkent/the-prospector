import { describe, expect, it } from "vitest";
import type { AgentRun } from "./types";
import { DAILY_RUN_HOUR, agentClock, ago, nextDue, until } from "./agent-clock";

const run = (over: Partial<AgentRun>): AgentRun =>
  ({ id: "r", endeavourId: "e1", phase: "done", startedAt: "2026-09-29T09:00:00Z", state: "OK", ...over }) as AgentRun;

const NOW = new Date("2026-09-29T12:00:00Z");

describe("nextDue", () => {
  it("is today when the hour has not come round yet", () => {
    const early = new Date("2026-09-29T05:00:00Z");
    expect(nextDue(early, DAILY_RUN_HOUR).toISOString()).toBe("2026-09-29T07:00:00.000Z");
  });

  it("is tomorrow once the hour has passed, because today's run is already queued", () => {
    expect(nextDue(NOW, DAILY_RUN_HOUR).toISOString()).toBe("2026-09-30T07:00:00.000Z");
  });

  it("rolls to tomorrow exactly on the hour, not a minute later", () => {
    const onTheHour = new Date("2026-09-29T07:00:00Z");
    expect(nextDue(onTheHour, DAILY_RUN_HOUR, "UTC").toISOString()).toBe("2026-09-30T07:00:00.000Z");
  });
});

describe("agentClock", () => {
  it("reports a run in progress and the phase it is on", () => {
    const clock = agentClock([run({ state: "RUNNING", phase: "qualify" })], NOW);
    expect(clock).toMatchObject({ pulse: "running", phase: "qualify", lastFailed: false });
  });

  it("prefers a running run over a finished one, whatever the order", () => {
    const clock = agentClock(
      [run({ id: "old", startedAt: "2026-09-29T09:00:00Z" }), run({ id: "now", startedAt: "2026-09-29T11:00:00Z", state: "RUNNING" })],
      NOW,
    );
    expect(clock.pulse).toBe("running");
  });

  it("says never rather than inventing a last run", () => {
    expect(agentClock([], NOW)).toMatchObject({ pulse: "never", lastRunAt: null, phase: null });
  });

  it("is idle after a recent run, and says whether it failed", () => {
    expect(agentClock([run({})], NOW)).toMatchObject({ pulse: "idle", lastFailed: false });
    expect(agentClock([run({ state: "FAILED" })], NOW)).toMatchObject({ pulse: "idle", lastFailed: true });
  });

  it("is stalled once more than a day and a half has passed", () => {
    // A late run is not a stalled one; a missed day is.
    expect(agentClock([run({ startedAt: "2026-09-28T09:00:00Z" })], NOW).pulse).toBe("idle");
    expect(agentClock([run({ startedAt: "2026-09-27T09:00:00Z" })], NOW).pulse).toBe("stalled");
  });

  it("gives a next-due time even when nothing has ever run", () => {
    expect(agentClock([], NOW).nextDueAt.toISOString()).toBe("2026-09-30T07:00:00.000Z");
  });
});

describe("ago", () => {
  it("counts up through the units", () => {
    expect(ago(new Date("2026-09-29T11:59:40Z"), NOW)).toBe("just now");
    expect(ago(new Date("2026-09-29T11:56:00Z"), NOW)).toBe("4m ago");
    expect(ago(new Date("2026-09-29T09:00:00Z"), NOW)).toBe("3h ago");
    expect(ago(new Date("2026-09-27T12:00:00Z"), NOW)).toBe("2d ago");
  });

  it("gives a date once a count stops meaning anything", () => {
    expect(ago(new Date("2026-09-01T12:00:00Z"), NOW)).toBe("2026-09-01");
  });
});

describe("until", () => {
  it("counts down through the units", () => {
    expect(until(new Date("2026-09-29T12:30:00Z"), NOW)).toBe("in 30m");
    expect(until(new Date("2026-09-29T17:00:00Z"), NOW)).toBe("in 5h");
    expect(until(new Date("2026-10-01T12:00:00Z"), NOW)).toBe("in 2d");
  });

  it("never counts backwards: something overdue is due now", () => {
    expect(until(new Date("2026-09-29T11:00:00Z"), NOW)).toBe("due now");
    expect(until(NOW, NOW)).toBe("due now");
  });
});
