import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { FIXTURE_IDS, seedFixtures } from "../../src/server/db/fixtures";
import * as t from "../../src/server/db/schema";
import { claimNext, enqueue } from "../../src/server/jobs/queue";
import {
  DAILY_RUN_JOB,
  POLL_INBOUND_JOB,
  SEND_DUE_JOB,
  bucketKey,
  dailyRunKey,
  scheduleDueRuns,
  scheduleRecurringWork,
  tick,
} from "../../src/server/jobs/worker";
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

describe("scheduleRecurringWork", () => {
  it("queues a send pass per mailbox and an inbox pass per endeavour", async () => {
    expect(await scheduleRecurringWork(db, MORNING)).toEqual({ queued: 2 });
    const queued = (await db.select().from(t.jobs)).map((j) => j.type).sort();
    expect(queued).toEqual([POLL_INBOUND_JOB, SEND_DUE_JOB]);
  });

  it("does not pile up when the worker ticks every few seconds", async () => {
    await scheduleRecurringWork(db, MORNING);
    await scheduleRecurringWork(db, new Date(MORNING.getTime() + 20_000));
    expect(await db.select().from(t.jobs)).toHaveLength(2);
  });

  it("queues again once the bucket has moved on", async () => {
    await scheduleRecurringWork(db, MORNING);
    const later = new Date(MORNING.getTime() + 6 * 60_000);
    expect((await scheduleRecurringWork(db, later)).queued).toBe(1); // sends every 5 minutes, inbox every 20
    expect((await db.select().from(t.jobs)).filter((j) => j.type === SEND_DUE_JOB)).toHaveLength(2);
  });

  it("leaves a paused endeavour and an endeavour with no mailbox alone", async () => {
    await db.update(t.endeavours).set({ status: "paused" }).where(eq(t.endeavours.id, FIXTURE_IDS.endeavour));
    expect(await scheduleRecurringWork(db, MORNING)).toEqual({ queued: 0 });

    await db.update(t.endeavours).set({ status: "active", mailboxId: null }).where(eq(t.endeavours.id, FIXTURE_IDS.endeavour));
    expect(await scheduleRecurringWork(db, MORNING)).toEqual({ queued: 0 });
  });

  it("keys each bucket by the minutes it covers", () => {
    const key = bucketKey("send", "mbx_1", MORNING, 5);
    expect(bucketKey("send", "mbx_1", new Date(MORNING.getTime() + 60_000), 5)).toBe(key);
    expect(bucketKey("send", "mbx_1", new Date(MORNING.getTime() + 6 * 60_000), 5)).not.toBe(key);
  });
});

describe("tick", () => {
  it("schedules and runs the daily loop, leaving a completed run behind", async () => {
    const result = await tick(db, { ...opts, now: MORNING });
    // The daily run, plus the two recurring jobs that keep working between runs.
    expect(result).toMatchObject({ queued: 3, processed: 3, failed: 0 });
    const [run] = await db.select().from(t.dailyRuns);
    expect(run).toMatchObject({ status: "succeeded", trigger: "schedule" });
    const daily = (await db.select().from(t.jobs)).find((j) => j.type === DAILY_RUN_JOB);
    expect(daily).toMatchObject({ status: "succeeded", attempts: 1 });
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
    // The recovered manual job, the scheduled daily run, and the two recurring jobs; the
    // second run finds the day already done.
    expect(result.processed).toBe(4);
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
