/**
 * How far a planning call has got, while it is still running.
 *
 * The planner is four independent passes under one `Promise.all`. Each resolving is a real
 * event, and reporting those is the difference between a progress bar and a decoration.
 *
 * Deliberately in memory, not in the database. This is ephemeral: it is meaningless once
 * the call returns, it is written several times a minute at most, and a migration plus a
 * table plus a cleanup job to hold something that lives for sixty seconds is a poor trade.
 * One web container serves this app, so a module-level map is the whole mechanism.
 *
 * What that costs: progress is lost if the container restarts mid-plan, and it would not
 * work across several instances. Both degrade to what was there before — an honest
 * indeterminate wait — rather than to a wrong number.
 */

/** Long enough for the slowest plan seen, short enough that nothing accumulates. */
export const PLAN_TTL_MS = 10 * 60_000;

export interface PlanProgress {
  /** Passes finished, in the order they finished. */
  done: string[];
  total: number;
  startedAt: number;
}

const plans = new Map<string, PlanProgress>();

/** Drops anything older than the window. Called on every write, so nothing schedules it. */
function sweep(now: number) {
  for (const [id, plan] of plans) {
    if (now - plan.startedAt > PLAN_TTL_MS) plans.delete(id);
  }
}

export function startPlan(id: string, total: number, now = Date.now()): void {
  if (!id) return;
  sweep(now);
  plans.set(id, { done: [], total, startedAt: now });
}

/**
 * Records a pass as finished.
 *
 * Unknown ids are ignored rather than created: a note for a plan nobody started is either
 * a stale retry or a client that has already walked away, and inventing an entry for it
 * would keep a phantom plan alive for the whole window.
 */
export function notePass(id: string, label: string): void {
  const plan = plans.get(id);
  if (!plan || plan.done.includes(label)) return;
  plan.done.push(label);
}

/** Null when nothing is running under that id, which the client reads as "not started yet". */
export function readPlan(id: string, now = Date.now()): PlanProgress | null {
  const plan = plans.get(id);
  if (!plan) return null;
  if (now - plan.startedAt > PLAN_TTL_MS) {
    plans.delete(id);
    return null;
  }
  return { ...plan, done: [...plan.done] };
}

/** Called when the call returns, successfully or not. Nothing is waiting on it any more. */
export function endPlan(id: string): void {
  plans.delete(id);
}

/** Test seam. Nothing in the app needs to know how many plans are in flight. */
export const inFlightPlans = () => plans.size;
