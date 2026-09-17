import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { DAILY_RUN_STEPS, runDailyLoop, type RunStep } from "../../src/server/jobs/daily-run";
import { FIXTURE_IDS, seedFixtures } from "../../src/server/db/fixtures";
import * as t from "../../src/server/db/schema";
import { testDb, truncateAll } from "./helpers";

const handle = testDb();
const db = handle.db;
afterAll(() => handle.close());
beforeEach(async () => {
  await truncateAll(handle);
  await seedFixtures(db);
});

const NOW = new Date("2026-09-17T09:00:00Z");
const run = (over: Partial<Parameters<typeof runDailyLoop>[1]> = {}) =>
  runDailyLoop(db, { endeavourId: FIXTURE_IDS.endeavour, trigger: "manual", now: NOW, ...over });

const runRow = async (id: string) => (await db.select().from(t.dailyRuns).where(eq(t.dailyRuns.id, id)))[0]!;
const logLines = async (id: string) =>
  (await db.select().from(t.runLog).where(eq(t.runLog.runId, id))).map((l) => `${l.level}: ${l.text}`);

describe("runDailyLoop", () => {
  it("records metrics, a brief and honest coverage gaps", async () => {
    const { runId, skipped } = await run();
    expect(skipped).toBe(false);
    const row = await runRow(runId);
    expect(row).toMatchObject({ status: "succeeded", phase: "done", checkpoint: DAILY_RUN_STEPS.length, runDate: "2026-09-17" });
    expect(row.metrics).toMatchObject({ prospects: 1, replied: 1 });

    const brief = row.brief as { risks: string[]; today: string[] };
    expect(brief.risks.join(" ")).toContain("W9");
    expect(brief.risks.join(" ")).toContain("W10");
    const lines = await logLines(runId);
    expect(lines.some((l) => l.startsWith("warn:") && l.includes("not built yet"))).toBe(true);
    expect(lines.some((l) => l.includes("daily brief written"))).toBe(true);

    const events = (await db.select().from(t.events)).map((e) => e.eventType);
    expect(events).toContain("run.completed");
  });

  it("runs once per endeavour per day", async () => {
    const first = await run();
    const second = await run({ trigger: "schedule" });
    expect(second).toEqual({ runId: first.runId, status: "succeeded", skipped: true });
    expect(await db.select().from(t.dailyRuns)).toHaveLength(1);
  });

  it("refuses a paused endeavour and records the failure", async () => {
    await db.update(t.endeavours).set({ status: "paused" }).where(eq(t.endeavours.id, FIXTURE_IDS.endeavour));
    await expect(run()).rejects.toThrow("not active");
    const [row] = await db.select().from(t.dailyRuns);
    expect(row).toMatchObject({ status: "failed", checkpoint: 0 });
    expect((await db.select().from(t.events)).map((e) => e.eventType)).toContain("run.failed");
  });

  it("resumes after the last completed step instead of repeating work", async () => {
    const calls: string[] = [];
    const step = (name: string, fail = false): RunStep => ({
      name,
      run: async () => {
        calls.push(name);
        if (fail) throw new Error("boom");
      },
    });

    await expect(run({ steps: [step("one"), step("two", true), step("three")] })).rejects.toThrow("boom");
    const [row] = await db.select().from(t.dailyRuns);
    expect(row).toMatchObject({ status: "failed", checkpoint: 1 });

    await run({ steps: [step("one"), step("two"), step("three")] });
    // "one" is not repeated: the resumed run starts at the failed step.
    expect(calls).toEqual(["one", "two", "two", "three"]);
    expect((await runRow(row!.id)).status).toBe("succeeded");
    expect(await logLines(row!.id)).toEqual(expect.arrayContaining([expect.stringContaining("resuming after step 1")]));
  });
});
