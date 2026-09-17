/**
 * The worker: recovers lost jobs, schedules due daily runs, and drains the queue.
 * One tick is a pure function of the database, so it can be driven from tests.
 */
import { and, eq, inArray } from "drizzle-orm";
import type { Database } from "../db/client";
import { dailyRuns, endeavours, jobs } from "../db/schema";
import { localDate, OPERATOR_TIMEZONE } from "../read/rows";
import type { AgentDeps } from "../agent/deps";
import type { SendDeps } from "../commands/send";
import { runDailyLoop } from "./daily-run";
import { claimNext, completeJob, enqueue, failJob, recoverStaleJobs, type JobRow } from "./queue";

export const DAILY_RUN_JOB = "endeavour.daily_run";

export interface JobContext {
  agent: AgentDeps | null;
  mail: SendDeps | null;
}

export type JobHandler = (db: Database, payload: Record<string, unknown>, now: Date, ctx: JobContext) => Promise<void>;

export const JOB_HANDLERS: Record<string, JobHandler> = {
  [DAILY_RUN_JOB]: async (db, payload, now, ctx) => {
    await runDailyLoop(db, {
      endeavourId: String(payload["endeavourId"]),
      trigger: payload["trigger"] === "manual" ? "manual" : "schedule",
      now,
      agent: ctx.agent,
      mail: ctx.mail,
    });
  },
};

export const dailyRunKey = (endeavourId: string, day: string) => `daily:${endeavourId}:${day}`;

/** Local hour of day, in the operator's timezone. */
function localHour(now: Date, timeZone = OPERATOR_TIMEZONE) {
  return Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone }).format(now));
}

/** Queues today's run for every active endeavour once the scheduled hour has passed. */
export async function scheduleDueRuns(db: Database, opts: { now: Date; hour: number }) {
  if (localHour(opts.now) < opts.hour) return { queued: 0 };
  const day = localDate(opts.now);
  const active = await db.select({ id: endeavours.id }).from(endeavours).where(eq(endeavours.status, "active"));
  if (active.length === 0) return { queued: 0 };

  const ids = active.map((e) => e.id);
  const done = await db
    .select({ endeavourId: dailyRuns.endeavourId })
    .from(dailyRuns)
    .where(and(inArray(dailyRuns.endeavourId, ids), eq(dailyRuns.runDate, day), eq(dailyRuns.status, "succeeded")));
  const finished = new Set(done.map((r) => r.endeavourId));

  let queued = 0;
  for (const id of ids) {
    if (finished.has(id)) continue;
    const { created } = await enqueue(db, {
      type: DAILY_RUN_JOB,
      payload: { endeavourId: id, trigger: "schedule" },
      idempotencyKey: dailyRunKey(id, day),
      runAt: opts.now,
    });
    if (created) queued += 1;
  }
  return { queued };
}

export async function runJob(db: Database, job: JobRow, now: Date, ctx: JobContext = { agent: null, mail: null }) {
  const handler = JOB_HANDLERS[job.type];
  if (!handler) throw new Error(`no handler for job type ${job.type}`);
  await handler(db, job.payload, now, ctx);
}

export interface TickResult {
  recovered: number;
  queued: number;
  processed: number;
  failed: number;
}

/** One pass: recover, schedule, then drain up to `max` jobs. */
export async function tick(
  db: Database,
  opts: { workerId: string; now?: Date; scheduleHour: number; max?: number; agent?: AgentDeps | null; mail?: SendDeps | null },
): Promise<TickResult> {
  const now = opts.now ?? new Date();
  const result: TickResult = { recovered: 0, queued: 0, processed: 0, failed: 0 };
  result.recovered = await recoverStaleJobs(db, now);
  result.queued = (await scheduleDueRuns(db, { now, hour: opts.scheduleHour })).queued;

  const max = opts.max ?? 10;
  for (let i = 0; i < max; i++) {
    const job = await claimNext(db, opts.workerId, now);
    if (!job) break;
    try {
      await runJob(db, job, now, { agent: opts.agent ?? null, mail: opts.mail ?? null });
      await completeJob(db, job.id);
      result.processed += 1;
    } catch (err) {
      await failJob(db, job, err instanceof Error ? err.message : String(err), now);
      result.failed += 1;
    }
  }
  return result;
}

export interface WorkerOptions {
  workerId: string;
  scheduleHour: number;
  agent?: AgentDeps | null;
  mail?: SendDeps | null;
  pollMs?: number;
  signal?: AbortSignal;
  onTick?: (result: TickResult) => void;
}

/** Long-running loop for the worker process. Stops cleanly when the signal aborts. */
export async function startWorker(db: Database, opts: WorkerOptions) {
  const pollMs = opts.pollMs ?? 15_000;
  while (!opts.signal?.aborted) {
    try {
      const result = await tick(db, {
        workerId: opts.workerId,
        scheduleHour: opts.scheduleHour,
        agent: opts.agent ?? null,
        mail: opts.mail ?? null,
      });
      opts.onTick?.(result);
    } catch (err) {
      console.error("worker tick failed", err);
    }
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, pollMs);
      opts.signal?.addEventListener("abort", () => {
        clearTimeout(timer);
        resolve(undefined);
      }, { once: true });
    });
  }
  // Release anything this worker still holds so another worker can pick it up.
  await db.update(jobs).set({ status: "queued", lockedAt: null, lockedBy: null }).where(and(eq(jobs.status, "running"), eq(jobs.lockedBy, opts.workerId)));
}
