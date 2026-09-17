import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { FIXTURE_IDS, seedFixtures } from "../../src/server/db/fixtures";
import * as t from "../../src/server/db/schema";
import { claimNext, enqueue } from "../../src/server/jobs/queue";
import { DAILY_RUN_JOB, dailyRunKey, scheduleDueRuns, tick } from "../../src/server/jobs/worker";
import { testDb, truncateAll } from "./helpers";

const handle = testDb();
const db = handle.db;
afterAll(() => handle.close());
beforeEach(async () => {
  await truncateAll(handle);
  await seedFixtures(db);
});

// 09:00 UTC is 10:00 in London; 05:00 UTC is 06:00, before a 07:00 schedule.
const MORNING = new Date("2026-09-17T09:00:00Z");
const EARLY = new Date("2026-09-17T05:00:00Z");
const opts = { workerId: "worker-test", scheduleHour: 7 };

describe("scheduleDueRuns", () => {
  it("waits for the scheduled hour in the operator's timezone", async () => {
    expect(await scheduleDueRuns(db, { now: EARLY, hour: 7 })).toEqual({ queued: 0 });
    expect(await scheduleDueRuns(db, { now: MORNING, hour: 7 })).toEqual({ queued: 1 });
    const [job] = await db.select().from(t.jobs);
    expect(job).toMatchObject({ type: DAILY_RUN_JOB, idempotencyKey: dailyRunKey(FIXTURE_IDS.endeavour, "2026-09-17") });
  });

  it("queues once a day and skips paused endeavours", async () => {
    await scheduleDueRuns(db, { now: MORNING, hour: 7 });
    await scheduleDueRuns(db, { now: MORNING, hour: 7 });
    expect(await db.select().from(t.jobs)).toHaveLength(1);

    await db.update(t.endeavours).set({ status: "paused" }).where(eq(t.endeavours.id, FIXTURE_IDS.endeavour));
    await db.delete(t.jobs);
    expect(await scheduleDueRuns(db, { now: MORNING, hour: 7 })).toEqual({ queued: 0 });
  });

  it("does not queue again once today's run has succeeded", async () => {
    await db.insert(t.dailyRuns).values({
      id: "run_done",
      endeavourId: FIXTURE_IDS.endeavour,
      runDate: "2026-09-17",
      trigger: "schedule",
      status: "succeeded",
    });
    expect(await scheduleDueRuns(db, { now: MORNING, hour: 7 })).toEqual({ queued: 0 });
  });
});

describe("tick", () => {
  it("schedules and runs the daily loop, leaving a completed run behind", async () => {
    const result = await tick(db, { ...opts, now: MORNING });
    expect(result).toMatchObject({ queued: 1, processed: 1, failed: 0 });
    const [run] = await db.select().from(t.dailyRuns);
    expect(run).toMatchObject({ status: "succeeded", trigger: "schedule" });
    const [job] = await db.select().from(t.jobs);
    expect(job).toMatchObject({ status: "succeeded", attempts: 1 });
  });

  it("retries a failing job instead of losing it", async () => {
    await db.update(t.endeavours).set({ status: "paused" }).where(eq(t.endeavours.id, FIXTURE_IDS.endeavour));
    await enqueue(db, {
      type: DAILY_RUN_JOB,
      payload: { endeavourId: FIXTURE_IDS.endeavour, trigger: "manual" },
      idempotencyKey: "manual:1",
      runAt: MORNING,
    });
    const result = await tick(db, { ...opts, now: MORNING });
    expect(result).toMatchObject({ processed: 0, failed: 1 });
    const [job] = await db.select().from(t.jobs);
    expect(job).toMatchObject({ status: "queued", attempts: 1 });
    expect(job!.lastError).toContain("not active");
  });

  it("recovers a job abandoned by a dead worker", async () => {
    await enqueue(db, {
      type: DAILY_RUN_JOB,
      payload: { endeavourId: FIXTURE_IDS.endeavour, trigger: "manual" },
      idempotencyKey: "manual:2",
      runAt: EARLY,
    });
    await claimNext(db, "dead-worker", EARLY);
    const result = await tick(db, { ...opts, now: new Date("2026-09-17T09:30:00Z") });
    expect(result.recovered).toBe(1);
    // The recovered manual job plus the scheduled daily run; the second finds the day already done.
    expect(result.processed).toBe(2);
    expect(await db.select().from(t.dailyRuns)).toHaveLength(1);
  });

  it("fails a job with no handler without crashing the worker", async () => {
    await enqueue(db, { type: "unknown.job", payload: {}, idempotencyKey: "unknown:1", runAt: MORNING, maxAttempts: 1 });
    const result = await tick(db, { ...opts, now: MORNING });
    expect(result.failed).toBe(1);
    const [job] = await db.select().from(t.jobs).where(eq(t.jobs.type, "unknown.job"));
    expect(job).toMatchObject({ status: "failed" });
    expect(job!.lastError).toContain("no handler");
  });
});
