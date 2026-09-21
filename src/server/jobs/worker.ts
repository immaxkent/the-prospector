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
import { inAppOnly, type DeliveryChannel } from "../notify/channels";
import { runDailyLoop } from "./daily-run";
import { claimNext, completeJob, enqueue, failJob, recoverStaleJobs, type JobRow } from "./queue";

export const DAILY_RUN_JOB = "endeavour.daily_run";
/** Releases whatever the pacing schedule says is due now. */
export const SEND_DUE_JOB = "mailbox.send_due";
/** Reads replies through the day, so an answer does not wait for tomorrow's run. */
export const POLL_INBOUND_JOB = "mailbox.poll_inbound";

/** How often each recurring job is queued. Both are cheap; the model is only called for replies. */
export const SEND_EVERY_MINUTES = 5;
export const POLL_EVERY_MINUTES = 20;

export interface JobContext {
  agent: AgentDeps | null;
  mail: SendDeps | null;
  notifications?: DeliveryChannel;
}

export type JobHandler = (db: Database, payload: Record<string, unknown>, now: Date, ctx: JobContext) => Promise<void>;

export const JOB_HANDLERS: Record<string, JobHandler> = {
  [SEND_DUE_JOB]: async (db, payload, now, ctx) => {
    if (!ctx.mail) return;
    const { sendApprovedForMailbox } = await import("../commands/send");
    await sendApprovedForMailbox(db, ctx.mail, { mailboxId: String(payload["mailboxId"]), now });
  },

  [POLL_INBOUND_JOB]: async (db, payload, now, ctx) => {
    const { processInbound } = await import("../commands/inbound");
    await processInbound(
      db,
      { agent: ctx.agent, mail: ctx.mail, notifications: ctx.notifications ?? inAppOnly },
      { endeavourId: String(payload["endeavourId"]), now },
    );
  },

  [DAILY_RUN_JOB]: async (db, payload, now, ctx) => {
    await runDailyLoop(db, {
      endeavourId: String(payload["endeavourId"]),
      trigger: payload["trigger"] === "manual" ? "manual" : "schedule",
      now,
      agent: ctx.agent,
      mail: ctx.mail,
      ...(ctx.notifications ? { notifications: ctx.notifications } : {}),
    });
  },
};

export const dailyRunKey = (endeavourId: string, day: string) => `daily:${endeavourId}:${day}`;

/** One key per bucket of minutes, so a tick every few seconds queues the work only once. */
export const bucketKey = (prefix: string, id: string, now: Date, everyMinutes: number) =>
  `${prefix}:${id}:${Math.floor(now.getTime() / (everyMinutes * 60_000))}`;

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

/**
 * Queues the work that keeps running between daily runs: releasing due sends, and reading
 * replies. Both are idempotent per bucket of minutes, so a fast tick does not pile them up.
 */
export async function scheduleRecurringWork(db: Database, now: Date) {
  const active = await db
    .select({ id: endeavours.id, mailboxId: endeavours.mailboxId })
    .from(endeavours)
    .where(eq(endeavours.status, "active"));
  if (active.length === 0) return { queued: 0 };

  let queued = 0;
  for (const mailboxId of new Set(active.map((e) => e.mailboxId).filter((id): id is string => !!id))) {
    const { created } = await enqueue(db, {
      type: SEND_DUE_JOB,
      payload: { mailboxId },
      idempotencyKey: bucketKey("send", mailboxId, now, SEND_EVERY_MINUTES),
      runAt: now,
    });
    if (created) queued += 1;
  }
  for (const endeavour of active) {
    if (!endeavour.mailboxId) continue;
    const { created } = await enqueue(db, {
      type: POLL_INBOUND_JOB,
      payload: { endeavourId: endeavour.id },
      idempotencyKey: bucketKey("poll", endeavour.id, now, POLL_EVERY_MINUTES),
      runAt: now,
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
  opts: {
    workerId: string;
    now?: Date;
    scheduleHour: number;
    max?: number;
    agent?: AgentDeps | null;
    mail?: SendDeps | null;
    notifications?: DeliveryChannel;
  },
): Promise<TickResult> {
  const now = opts.now ?? new Date();
  const result: TickResult = { recovered: 0, queued: 0, processed: 0, failed: 0 };
  result.recovered = await recoverStaleJobs(db, now);
  result.queued = (await scheduleDueRuns(db, { now, hour: opts.scheduleHour })).queued;
  result.queued += (await scheduleRecurringWork(db, now)).queued;

  const max = opts.max ?? 10;
  for (let i = 0; i < max; i++) {
    const job = await claimNext(db, opts.workerId, now);
    if (!job) break;
    try {
      await runJob(db, job, now, {
        agent: opts.agent ?? null,
        mail: opts.mail ?? null,
        ...(opts.notifications ? { notifications: opts.notifications } : {}),
      });
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
  notifications?: DeliveryChannel;
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
        ...(opts.notifications ? { notifications: opts.notifications } : {}),
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
