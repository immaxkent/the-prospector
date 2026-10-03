import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { FixtureAgentLlm } from "../../src/server/agent/fixture";
import { FIXTURE_IDS, seedFixtures } from "../../src/server/db/fixtures";
import * as t from "../../src/server/db/schema";
import { loadPhaseSpend } from "../../src/server/commands/settings";
import { budgetedLlm, BudgetExceededError } from "../../src/server/llm/budgeted";
import { loadBudgetState } from "../../src/server/commands/settings";
import { dbRecorder } from "../../src/server/llm/recorder";
import { runDailyLoop } from "../../src/server/jobs/daily-run";
import { testDb, truncateAll } from "./helpers";

const handle = testDb();
const db = handle.db;
afterAll(() => handle.close());

const NOW = new Date("2026-09-17T09:00:00Z");
/*
 * The day it happened, and the date matters: a £15 month is 50p a day in September and 48p
 * in October, and the run spent 54p. Testing it in September would have been testing a day
 * that was never exhausted.
 */
const OCTOBER = new Date("2026-10-01T20:25:00Z");
const USD_PER_GBP = 1.27;

beforeEach(async () => {
  await truncateAll(handle);
  await seedFixtures(db);
});

/** Spend recorded against a role, as a finished call would leave it. */
const spend = (role: string, costUsd: number, i: number, at: Date = NOW) =>
  db.insert(t.llmCalls).values({
    id: `llm_${role.replace(/\W/g, "")}_${i}`,
    runId: null,
    role,
    promptVersion: "v",
    model: "claude-haiku-4-5",
    inputHash: `h${i}`,
    inputTokens: 100,
    outputTokens: 10,
    costUsd,
    status: "ok",
    createdAt: at,
  });

describe("spend by phase", () => {
  it("attributes each call to the phase that made it, from the role it recorded", async () => {
    await spend("research.discover", 0.4, 1);
    await spend("research.qualify", 0.1, 2);
    await spend("conversation.classify", 0.02, 3);
    // Intake is not a run phase and must not be counted against one.
    await spend("intake.planner", 0.5, 4);

    const byPhase = await loadPhaseSpend(db, USD_PER_GBP, NOW);
    expect(byPhase.research).toBe(31);
    expect(byPhase.qualify).toBe(8);
    expect(byPhase.reply).toBe(2);
    expect(Object.keys(byPhase).sort()).toEqual(["qualify", "reply", "research"]);
  });
});

describe("the first of October, reproduced", () => {
  /**
   * The run that found eighteen prospects and scored none of them: research spent $0.68 of
   * a ~48p day, so every qualification call was refused for want of money the day never
   * had left.
   */
  it("refused qualification outright, which is what this fixes", async () => {
    await db.insert(t.appSettings).values({ id: "singleton", monthlyBudgetPence: 1500, model: "claude-haiku-4-5" }).onConflictDoNothing();
    // $0.68 is 54p, against a 48p October day. The day really was spent — that part of the
    // old behaviour was never wrong, it was the only phase that got to spend it.
    await spend("research.discover", 0.68, 1, OCTOBER);
    expect((await loadBudgetState(db, USD_PER_GBP, OCTOBER)).allowed).toBe(false);
  });

  it("stops research at its own share, leaving the rest of the day for the rest of the run", async () => {
    // A 48p day splits 5/22/12/9 across reply, research, qualify and draft. Reply spends 6p
    // so research inherits no surplus, then research spends its 22p. 28p of the day is gone
    // and qualification's 12p is untouched.
    await spend("conversation.classify", 0.07, 1, OCTOBER);
    await spend("research.discover", 0.28, 2, OCTOBER);

    const llm = budgetedLlm(
      { complete: async () => ({}) as never },
      () => loadBudgetState(db, USD_PER_GBP, OCTOBER),
      () => loadPhaseSpend(db, USD_PER_GBP, OCTOBER),
    );
    const ask = (role: string) => ({ role, model: "m", system: "s", user: "u", jsonSchema: {}, maxTokens: 10 });

    await expect(llm.complete(ask("research.discover"))).rejects.toBeInstanceOf(BudgetExceededError);
    // And the point: qualification still has its own money.
    await expect(llm.complete(ask("research.qualify"))).resolves.toBeDefined();
  });

  it("names the phase rather than the day, so nobody goes looking at their billing", async () => {
    await spend("conversation.classify", 0.07, 1, OCTOBER);
    await spend("research.discover", 0.28, 2, OCTOBER);
    const llm = budgetedLlm(
      { complete: async () => ({}) as never },
      () => loadBudgetState(db, USD_PER_GBP, OCTOBER),
      () => loadPhaseSpend(db, USD_PER_GBP, OCTOBER),
    );
    await expect(
      llm.complete({ role: "research.discover", model: "m", system: "s", user: "u", jsonSchema: {}, maxTokens: 10 }),
    ).rejects.toThrow(/research has spent its share of today/);
  });
});

describe("a whole run under a phase budget", () => {
  it("still researches and qualifies on a day that would previously have bought only research", async () => {
    const inner = new FixtureAgentLlm();
    const llm = budgetedLlm(
      inner,
      () => loadBudgetState(db, USD_PER_GBP, NOW),
      () => loadPhaseSpend(db, USD_PER_GBP, NOW),
    );

    await runDailyLoop(db, {
      endeavourId: FIXTURE_IDS.endeavour,
      trigger: "manual",
      now: NOW,
      agent: { llm, model: "claude-haiku-4-5", record: dbRecorder(db) },
    });

    const roles = (await db.select().from(t.llmCalls)).map((c) => c.role);
    expect(roles).toContain("research.discover");
    expect(roles).toContain("research.qualify");

    const scored = await db.select().from(t.prospects).where(eq(t.prospects.source, "web_research"));
    expect(scored.some((p) => p.qualificationScore !== null)).toBe(true);
  });
});

describe("a phase running out is not the day running out", () => {
  it("carries on to the next phase instead of ending the run", async () => {
    // Stopping here would reproduce the exact failure the division was built to prevent,
    // one layer further out: research exhausts itself and nothing is ever scored.
    const inner = new FixtureAgentLlm();
    let calls = 0;
    const llm = {
      complete: async (request: Parameters<typeof inner.complete>[0]) => {
        // Research is refused from its second call, as an exhausted share would refuse it.
        if (request.role === "research.discover" && ++calls > 1) {
          throw new BudgetExceededError(await loadBudgetState(db, USD_PER_GBP, NOW), "research", "research has spent its share of today");
        }
        return inner.complete(request);
      },
    };

    const result = await runDailyLoop(db, {
      endeavourId: FIXTURE_IDS.endeavour,
      trigger: "manual",
      now: NOW,
      agent: { llm, model: "claude-haiku-4-5", record: dbRecorder(db) },
    });

    expect(result.status).toBe("succeeded");
    expect(result).not.toMatchObject({ stoppedOnBudget: true });

    // The run went past research and qualified what research had already found.
    const roles = (await db.select().from(t.llmCalls)).map((c) => c.role);
    expect(roles).toContain("research.qualify");

    const [runRow] = await db.select().from(t.dailyRuns);
    expect((runRow!.metrics as Record<string, number>)["phasesOutOfBudget"]).toBeGreaterThan(0);
    // And the operator is told which phase, in the risks they actually read.
    expect(((runRow!.brief?.["risks"] ?? []) as string[]).join("\n")).toContain("stopped early");
  });

  it("still ends the run when the day itself is gone", async () => {
    const inner = new FixtureAgentLlm();
    const llm = {
      complete: async (request: Parameters<typeof inner.complete>[0]) => {
        if (request.role === "research.discover") {
          const state = await loadBudgetState(db, USD_PER_GBP, NOW);
          throw new BudgetExceededError({ ...state, allowed: false, reason: "daily_budget_spent" });
        }
        return inner.complete(request);
      },
    };

    const result = await runDailyLoop(db, {
      endeavourId: FIXTURE_IDS.endeavour,
      trigger: "manual",
      now: NOW,
      agent: { llm, model: "claude-haiku-4-5", record: dbRecorder(db) },
    });
    expect(result).toMatchObject({ stoppedOnBudget: true });
  });
});
