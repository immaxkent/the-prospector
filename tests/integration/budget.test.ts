import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { FixtureAgentLlm } from "../../src/server/agent/fixture";
import { CommandError } from "../../src/server/commands/errors";
import { loadBudgetState, loadSettings, loadSpend, updateSettings } from "../../src/server/commands/settings";
import { FIXTURE_IDS, seedFixtures } from "../../src/server/db/fixtures";
import * as t from "../../src/server/db/schema";
import { DEFAULT_BUDGET } from "../../src/server/domain/budget";
import { runDailyLoop } from "../../src/server/jobs/daily-run";
import { budgetedLlm } from "../../src/server/llm/budgeted";
import { dbRecorder } from "../../src/server/llm/recorder";
import { testDb, truncateAll } from "./helpers";

const handle = testDb();
const db = handle.db;
afterAll(() => handle.close());

const NOW = new Date("2026-09-17T09:00:00Z");
const RATE = 1.25;

/** A recorded call that cost what we say it cost, on the day we say. */
async function recordCall(costUsd: number, createdAt = NOW, id = `llm_${Math.random().toString(36).slice(2)}`) {
  await db.insert(t.llmCalls).values({
    id,
    role: "research.discover",
    promptVersion: "v1",
    model: "claude-haiku-4-5",
    inputHash: "h",
    inputTokens: 100,
    outputTokens: 100,
    costUsd,
    status: "ok",
    createdAt,
  });
}

beforeEach(async () => {
  await truncateAll(handle);
  await seedFixtures(db);
});

describe("settings", () => {
  it("starts on the cheapest model with a fifteen pound month", async () => {
    expect(await loadSettings(db)).toEqual(DEFAULT_BUDGET);
    expect(DEFAULT_BUDGET.monthlyBudgetPence).toBe(1500);
  });

  it("stores a choice and records it as an event", async () => {
    await updateSettings(db, { model: "claude-sonnet-5", monthlyBudgetPence: 4000 });
    expect(await loadSettings(db)).toEqual({ model: "claude-sonnet-5", monthlyBudgetPence: 4000 });
    const [event] = await db.select().from(t.events).where(eq(t.events.eventType, "settings.updated"));
    expect(event!.payload).toMatchObject({ detail: "model claude-sonnet-5 · £40.00 a month" });

    // Saving the same values again is not a change, so nothing is recorded twice.
    await updateSettings(db, { model: "claude-sonnet-5", monthlyBudgetPence: 4000 });
    expect(await db.select().from(t.events).where(eq(t.events.eventType, "settings.updated"))).toHaveLength(1);
  });

  it("refuses a model it cannot price and a budget it will not set by hand", async () => {
    for (const input of [
      { model: "llama-3", monthlyBudgetPence: 1500 },
      { model: "claude-haiku-4-5", monthlyBudgetPence: -1 },
      { model: "claude-haiku-4-5", monthlyBudgetPence: 10_000_000 },
    ]) {
      await expect(updateSettings(db, input)).rejects.toBeInstanceOf(CommandError);
    }
  });
});

describe("spend", () => {
  it("counts today and the month apart", async () => {
    await recordCall(0.4);
    await recordCall(0.1, new Date("2026-09-16T09:00:00Z"));
    await recordCall(99, new Date("2026-08-31T09:00:00Z")); // last month: not counted
    const spend = await loadSpend(db, NOW);
    expect(spend.todayUsd).toBeCloseTo(0.4);
    expect(spend.monthUsd).toBeCloseTo(0.5);
  });

  it("reports what is left of today against the stored budget", async () => {
    await recordCall(0.25); // 20p of a 50p day
    const state = await loadBudgetState(db, RATE, NOW);
    expect(state).toMatchObject({ spentTodayPence: 20, dailyAllowancePence: 50, remainingTodayPence: 30, allowed: true });
  });
});

describe("the daily run against a spent budget", () => {
  const agent = () => ({
    llm: budgetedLlm(new FixtureAgentLlm(), () => loadBudgetState(db, RATE, NOW)),
    model: "claude-haiku-4-5",
    record: dbRecorder(db),
  });

  it("stops where it got to, keeps the work, and says why", async () => {
    await recordCall(1); // 80p: past the 50p day
    const result = await runDailyLoop(db, { endeavourId: FIXTURE_IDS.endeavour, trigger: "manual", now: NOW, agent: agent() });
    expect(result).toMatchObject({ stoppedOnBudget: true, status: "succeeded" });

    const [run] = await db.select().from(t.dailyRuns).where(eq(t.dailyRuns.id, result.runId));
    // Not "failed": the operator set this ceiling, so honouring it is success.
    expect(run!.status).toBe("succeeded");
    expect(run!.metrics).toMatchObject({ stoppedOnBudget: 1 });
    expect((run!.brief as { risks: string[] }).risks.join(" ")).toContain("budget");

    const log = (await db.select().from(t.runLog)).map((l) => l.text).join("\n");
    expect(log).toContain("today's share of the model budget is spent");

    const [notification] = await db.select().from(t.notifications).where(eq(t.notifications.kind, "budget_spent"));
    expect(notification!.body).toContain("Nothing was lost");
    expect((await db.select().from(t.events)).map((e) => e.eventType)).toContain("run.stopped_on_budget");
  });

  it("runs normally when there is budget left", async () => {
    const result = await runDailyLoop(db, { endeavourId: FIXTURE_IDS.endeavour, trigger: "manual", now: NOW, agent: agent() });
    expect(result).not.toMatchObject({ stoppedOnBudget: true });
    expect(await db.select().from(t.notifications).where(eq(t.notifications.kind, "budget_spent"))).toEqual([]);
  });

  it("spends nothing at all when the budget is zero", async () => {
    await updateSettings(db, { model: "claude-haiku-4-5", monthlyBudgetPence: 0 });
    const result = await runDailyLoop(db, { endeavourId: FIXTURE_IDS.endeavour, trigger: "manual", now: NOW, agent: agent() });
    expect(result).toMatchObject({ stoppedOnBudget: true });
    expect(await db.select().from(t.llmCalls)).toEqual([]);
  });
});
