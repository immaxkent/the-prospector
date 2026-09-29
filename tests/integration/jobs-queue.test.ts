import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  RETRY_BACKOFF_MS,
  STALE_AFTER_MS,
  claimNext,
  completeJob,
  enqueue,
  failJob,
  heartbeatJob,
  recoverStaleJobs,
} from "../../src/server/jobs/queue";
import * as t from "../../src/server/db/schema";
import { testDb, truncateAll } from "./helpers";

const handle = testDb();
const db = handle.db;
afterAll(() => handle.close());
beforeEach(() => truncateAll(handle));

const job = (o: Partial<Parameters<typeof enqueue>[1]> = {}) => ({
  type: "endeavour.daily_run",
  payload: { endeavourId: "end_1" },
  idempotencyKey: "daily:end_1:2026-09-17",
  ...o,
});

const row = async (id: string) => (await db.select().from(t.jobs).where(eq(t.jobs.id, id)))[0]!;

describe("enqueue", () => {
  it("queues once per idempotency key", async () => {
    const first = await enqueue(db, job());
    const second = await enqueue(db, job({ payload: { endeavourId: "other" } }));
    expect(first.created).toBe(true);
    expect(second).toMatchObject({ created: false, job: { id: first.job.id } });
    expect(await db.select().from(t.jobs)).toHaveLength(1);
  });
});

describe("claimNext", () => {
  it("claims the oldest due job and leaves future ones alone", async () => {
    const now = new Date("2026-09-17T09:00:00Z");
    await enqueue(db, job({ idempotencyKey: "a", runAt: new Date("2026-09-17T08:00:00Z") }));
    await enqueue(db, job({ idempotencyKey: "b", runAt: new Date("2026-09-17T08:30:00Z") }));
    await enqueue(db, job({ idempotencyKey: "later", runAt: new Date("2026-09-17T10:00:00Z") }));

    const first = await claimNext(db, "worker-1", now);
    expect(first).toMatchObject({ idempotencyKey: "a", status: "running", attempts: 1, lockedBy: "worker-1" });
    const second = await claimNext(db, "worker-2", now);
    expect(second!.idempotencyKey).toBe("b");
    expect(await claimNext(db, "worker-3", now)).toBeNull();
  });

  it("never hands the same job to two workers", async () => {
    await enqueue(db, job());
    const [a, b] = await Promise.all([claimNext(db, "w1"), claimNext(db, "w2")]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
  });
});

describe("completing and failing", () => {
  it("marks success and clears the lock", async () => {
    const { job: queued } = await enqueue(db, job());
    const claimed = await claimNext(db, "w1");
    await completeJob(db, claimed!.id);
    expect(await row(queued.id)).toMatchObject({ status: "succeeded", lockedBy: null, lastError: null });
  });

  it("retries with backoff, then fails for good", async () => {
    const now = new Date("2026-09-17T09:00:00Z");
    const { job: queued } = await enqueue(db, job({ maxAttempts: 2, runAt: now }));

    const first = await claimNext(db, "w1", now);
    const retry = await failJob(db, first!, "search provider timed out", now);
    expect(retry.retrying).toBe(true);
    expect(await row(queued.id)).toMatchObject({ status: "queued", attempts: 1, lastError: "search provider timed out" });
    expect(retry.retryAt!.getTime()).toBe(now.getTime() + RETRY_BACKOFF_MS[0]!);

    const second = await claimNext(db, "w1", new Date(retry.retryAt!.getTime() + 1));
    const done = await failJob(db, second!, "still failing");
    expect(done.retrying).toBe(false);
    expect(await row(queued.id)).toMatchObject({ status: "failed", attempts: 2 });
  });
});

describe("heartbeatJob", () => {
  it("keeps a long job from being recovered while it is still working", async () => {
    const start = new Date("2026-09-28T09:00:00Z");
    await enqueue(db, { type: "slow.job", payload: {}, idempotencyKey: "slow:1", runAt: start });
    const job = await claimNext(db, "worker-a", start);

    // Halfway through the window the worker says it is still alive.
    const midway = new Date(start.getTime() + STALE_AFTER_MS / 2);
    expect(await heartbeatJob(db, job!.id, midway)).toBe(true);

    // What would have been past the cutoff is now inside it, measured from the beat.
    const later = new Date(start.getTime() + STALE_AFTER_MS + 1000);
    expect(await recoverStaleJobs(db, later)).toBe(0);
    const [row] = await db.select().from(t.jobs).where(eq(t.jobs.id, job!.id));
    expect(row!.status).toBe("running");
  });

  it("still lets a job be recovered once the beats stop", async () => {
    const start = new Date("2026-09-28T09:00:00Z");
    await enqueue(db, { type: "dead.job", payload: {}, idempotencyKey: "dead:1", runAt: start });
    const job = await claimNext(db, "worker-a", start);
    await heartbeatJob(db, job!.id, new Date(start.getTime() + 1000));

    const later = new Date(start.getTime() + STALE_AFTER_MS + 2000);
    expect(await recoverStaleJobs(db, later)).toBe(1);
  });

  it("refuses to revive a job that is no longer running", async () => {
    // A beat from a worker whose job was already recovered would take a lock it lost.
    const start = new Date("2026-09-28T09:00:00Z");
    await enqueue(db, { type: "done.job", payload: {}, idempotencyKey: "done:1", runAt: start });
    const job = await claimNext(db, "worker-a", start);
    await completeJob(db, job!.id);
    expect(await heartbeatJob(db, job!.id)).toBe(false);
  });

  it("changes nothing but the lock", async () => {
    const start = new Date("2026-09-28T09:00:00Z");
    await enqueue(db, { type: "slow.job", payload: { keep: "me" }, idempotencyKey: "slow:2", runAt: start });
    const job = await claimNext(db, "worker-a", start);
    await heartbeatJob(db, job!.id, new Date(start.getTime() + 1000));

    const [row] = await db.select().from(t.jobs).where(eq(t.jobs.id, job!.id));
    expect(row).toMatchObject({ status: "running", attempts: job!.attempts, payload: { keep: "me" }, lockedBy: "worker-a" });
  });
});

describe("recoverStaleJobs", () => {
  it("requeues jobs whose worker died and marks the exhausted ones interrupted", async () => {
    const start = new Date("2026-09-17T09:00:00Z");
    const later = new Date(start.getTime() + STALE_AFTER_MS + 1000);
    await enqueue(db, job({ idempotencyKey: "retryable", maxAttempts: 3, runAt: start }));
    await enqueue(db, job({ idempotencyKey: "exhausted", maxAttempts: 1, runAt: start }));
    const a = await claimNext(db, "dead-worker", start);
    const b = await claimNext(db, "dead-worker", start);

    expect(await recoverStaleJobs(db, later)).toBe(2);
    expect(await row(a!.id)).toMatchObject({ status: "queued", lockedBy: null });
    expect(await row(b!.id)).toMatchObject({ status: "interrupted" });
    expect((await row(a!.id)).lastError).toContain("worker stopped");
  });

  it("leaves a healthy running job alone", async () => {
    await enqueue(db, job());
    const claimed = await claimNext(db, "w1");
    expect(await recoverStaleJobs(db)).toBe(0);
    expect(await row(claimed!.id)).toMatchObject({ status: "running" });
  });
});
