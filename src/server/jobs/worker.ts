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
import { claimNext, completeJob, enqueue, failJob, heartbeatJob, recoverStaleJobs, STALE_AFTER_MS, type JobRow } from "./queue";

export const DAILY_RUN_JOB = "endeavour.daily_run";

/** A third of the stale window: one missed beat still leaves two before the job is reclaimed. */
export const HEARTBEAT_MS = Math.floor(STALE_AFTER_MS / 3);
/** Releases whatever the pacing schedule says is due now. */
export const SEND_DUE_JOB = "mailbox.send_due";
/** Reads replies through the day, so an answer does not wait for tomorrow's run. */
export const POLL_INBOUND_JOB = "mailbox.poll_inbound";

/** How often each recurring job is queued. Both are cheap; the model is only called for replies. */
export const SEND_EVERY_MINUTES = 5;
export const POLL_EVERY_MINUTES = 20;

/** The digest and the weekly review. One job type; the payload says which. */
export const REPORT_JOB = "endeavour.report";

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

  [REPORT_JOB]: async (db, payload, now, ctx) => {
    const [{ sendReport }, { loadBudgetState }, { getConfig }] = await Promise.all([
      import("../reports/send"),
      import("../commands/settings"),
      import("../config"),
    ]);
    // Read here rather than inside the report: a digest is worth sending even when the
    // budget cannot be read, and "unknown" must not be reported as "spent".
    const remaining = await loadBudgetState(db, getConfig().usdPerGbp, now)
      .then((b) => b.remainingTodayPence)
      .catch(() => null);
    await sendReport(
      db,
      { notifications: ctx.notifications ?? inAppOnly, agent: ctx.agent, budgetRemainingPence: remaining },
      { endeavourId: String(payload["endeavourId"]), kind: payload["kind"] === "review" ? "review" : "digest", now },
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

  // Reports are queued on the endeavour's own clock rather than the server's, and the
  // idempotency key is that local day: a box that ticks every few seconds must not queue
  // the same digest a thousand times, and one restarted at noon must still send today's.
  const { digestDue, localMoment, normaliseReporting, reviewDue } = await import("../domain/reporting-schedule");
  const { DIGEST_SENT, REVIEW_SENT, lastSentAt } = await import("../reports/collect");
  const { normaliseSettings } = await import("../domain/endeavour-settings");

  for (const endeavour of active) {
    const [row] = await db.select({ settings: endeavours.settings }).from(endeavours).where(eq(endeavours.id, endeavour.id));
    const schedule = normaliseReporting(normaliseSettings(row?.settings).reporting);
    const today = localMoment(now, schedule.timezone).date;

    for (const [kind, due, eventType] of [
      ["digest", digestDue, DIGEST_SENT],
      ["review", reviewDue, REVIEW_SENT],
    ] as const) {
      if (!due(now, schedule, await lastSentAt(db, endeavour.id, eventType))) continue;
      const { created } = await enqueue(db, {
        type: REPORT_JOB,
        payload: { endeavourId: endeavour.id, kind },
        idempotencyKey: `report:${kind}:${endeavour.id}:${today}`,
        runAt: now,
      });
      if (created) queued += 1;
    }
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
    // A daily run outlives the stale window on purpose: qualify and draft each wait up to
    // five minutes on a batch, and the window is ten. Without a heartbeat the queue cannot
    // tell this from a dead worker, reclaims the job mid-flight, and buys its research
    // twice. The lock is refreshed well inside the window so one slow beat is not fatal.
    const beat = setInterval(() => {
      void heartbeatJob(db, job.id).catch(() => {
        // A failed beat is not worth killing the work over; the next one will do.
      });
    }, HEARTBEAT_MS);
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
    } finally {
      clearInterval(beat);
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
