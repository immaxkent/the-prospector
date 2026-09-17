/**
 * Persisted job queue. One row per unit of work, claimed with SKIP LOCKED so
 * several workers can run, retried with backoff, and recoverable after a crash.
 */
import { and, eq, lte, or, sql } from "drizzle-orm";
import type { Database } from "../db/client";
import { jobs } from "../db/schema";
import { newId } from "../ids";

export type JobRow = typeof jobs.$inferSelect;

export const RETRY_BACKOFF_MS = [60_000, 300_000, 900_000];
/** A claimed job whose worker has not finished or reported in by then is considered lost. */
export const STALE_AFTER_MS = 10 * 60_000;

export interface EnqueueInput {
  type: string;
  payload: Record<string, unknown>;
  /** Makes enqueueing safe to repeat: the same key never queues twice. */
  idempotencyKey: string;
  runAt?: Date;
  maxAttempts?: number;
}

/** Returns the existing job when the key was already queued. */
export async function enqueue(db: Database, input: EnqueueInput) {
  const [row] = await db
    .insert(jobs)
    .values({
      id: newId("job"),
      type: input.type,
      payload: input.payload,
      idempotencyKey: input.idempotencyKey,
      runAt: input.runAt ?? new Date(),
      maxAttempts: input.maxAttempts ?? 3,
    })
    .onConflictDoNothing({ target: jobs.idempotencyKey })
    .returning();
  if (row) return { job: row, created: true as const };
  const [existing] = await db.select().from(jobs).where(eq(jobs.idempotencyKey, input.idempotencyKey));
  return { job: existing!, created: false as const };
}

/** Claims the oldest due job for this worker, or returns null when nothing is due. */
export async function claimNext(db: Database, workerId: string, now = new Date()): Promise<JobRow | null> {
  const stamp = now.toISOString();
  // Raw SQL for SKIP LOCKED; the row is then read back through the typed query.
  const claimed = await db.execute<{ id: string }>(sql`
    update ${jobs} set
      status = 'running',
      attempts = ${jobs.attempts} + 1,
      locked_at = ${stamp}::timestamptz,
      locked_by = ${workerId},
      updated_at = ${stamp}::timestamptz
    where id = (
      select id from ${jobs}
      where status = 'queued' and run_at <= ${stamp}::timestamptz
      order by run_at
      for update skip locked
      limit 1
    )
    returning id
  `);
  const id = claimed[0]?.id;
  if (!id) return null;
  const [row] = await db.select().from(jobs).where(eq(jobs.id, id));
  return row ?? null;
}

export async function completeJob(db: Database, jobId: string) {
  await db.update(jobs).set({ status: "succeeded", lockedAt: null, lockedBy: null, lastError: null }).where(eq(jobs.id, jobId));
}

/** Retries with backoff until the attempt limit, then leaves the job failed. */
export async function failJob(db: Database, job: JobRow, error: string, now = new Date()) {
  const retriesLeft = job.attempts < job.maxAttempts;
  const delay = RETRY_BACKOFF_MS[Math.min(job.attempts - 1, RETRY_BACKOFF_MS.length - 1)] ?? 0;
  await db
    .update(jobs)
    .set({
      status: retriesLeft ? "queued" : "failed",
      runAt: retriesLeft ? new Date(now.getTime() + delay) : job.runAt,
      lockedAt: null,
      lockedBy: null,
      lastError: error.slice(0, 2_000),
    })
    .where(eq(jobs.id, job.id));
  return { retrying: retriesLeft, retryAt: retriesLeft ? new Date(now.getTime() + delay) : null };
}

/**
 * Recovers jobs whose worker died: they go back in the queue, or are marked
 * interrupted once they are out of attempts, so nothing is silently lost.
 */
export async function recoverStaleJobs(db: Database, now = new Date()) {
  const cutoff = new Date(now.getTime() - STALE_AFTER_MS);
  const stale = await db
    .select()
    .from(jobs)
    .where(and(eq(jobs.status, "running"), or(lte(jobs.lockedAt, cutoff), sql`${jobs.lockedAt} is null`)));
  for (const job of stale) {
    const retriesLeft = job.attempts < job.maxAttempts;
    await db
      .update(jobs)
      .set({
        status: retriesLeft ? "queued" : "interrupted",
        lockedAt: null,
        lockedBy: null,
        lastError: "worker stopped before the job finished",
        runAt: now,
      })
      .where(eq(jobs.id, job.id));
  }
  return stale.length;
}
