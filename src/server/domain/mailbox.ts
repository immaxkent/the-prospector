/**
 * Mailboxes are shared resources. Caps and warm-up apply per mailbox,
 * across every endeavour that sends through it.
 */
import { z } from "zod/v4";

export const MAILBOX_PROVIDERS = ["google"] as const;
export const MAILBOX_STATUSES = ["connected", "needs_reauth", "disconnected"] as const;

export const warmupSchema = z.object({
  startedOn: z.iso.date(),
  startCap: z.number().int().positive(),
  incrementPerDay: z.number().int().min(0),
});

export const mailboxLimitsSchema = z.object({
  dailyCap: z.number().int().positive(),
  weeklyCap: z.number().int().positive(),
  warmup: warmupSchema.nullable(),
  /** Local hours [start, end) during which nothing is sent, e.g. 20 → 7. */
  quietHours: z.object({ start: z.number().int().min(0).max(23), end: z.number().int().min(0).max(23) }),
  timezone: z.string().min(1),
});

export type MailboxLimits = z.infer<typeof mailboxLimitsSchema>;

export const DEFAULT_MAILBOX_LIMITS: MailboxLimits = {
  dailyCap: 30,
  weeklyCap: 150,
  warmup: null,
  quietHours: { start: 20, end: 7 },
  timezone: "Europe/London",
};

function daysBetween(fromIsoDate: string, toIsoDate: string) {
  return Math.floor((Date.parse(toIsoDate) - Date.parse(fromIsoDate)) / 86_400_000);
}

/** Today's cap after warm-up. Warm-up can only lower the configured cap, never raise it. */
export function effectiveDailyCap(limits: MailboxLimits, today: string) {
  if (!limits.warmup) return limits.dailyCap;
  const days = Math.max(0, daysBetween(limits.warmup.startedOn, today));
  return Math.min(limits.dailyCap, limits.warmup.startCap + days * limits.warmup.incrementPerDay);
}

export interface SendUsage {
  sentToday: number;
  sentLast7Days: number;
}

export function remainingSends(limits: MailboxLimits, usage: SendUsage, today: string) {
  const daily = effectiveDailyCap(limits, today) - usage.sentToday;
  const weekly = limits.weeklyCap - usage.sentLast7Days;
  return Math.max(0, Math.min(daily, weekly));
}

export function isQuietHour(limits: MailboxLimits, at: Date) {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: limits.timezone }).format(at),
  );
  const { start, end } = limits.quietHours;
  if (start === end) return false;
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}

export interface SendRequest {
  endeavourId: string;
  requested: number;
  /** Lower sends first when capacity is short. */
  priority: number;
}

/**
 * Splits a mailbox's remaining capacity between endeavours.
 * Priority groups are served in order; inside a group, one send at a time
 * so no endeavour starves another of equal priority.
 */
export function allocateSends(capacity: number, requests: readonly SendRequest[]) {
  const ordered = [...requests].sort((a, b) => a.priority - b.priority || a.endeavourId.localeCompare(b.endeavourId));
  const granted = new Map(ordered.map((r) => [r.endeavourId, 0]));
  let left = Math.max(0, capacity);
  const priorities = [...new Set(ordered.map((r) => r.priority))];
  for (const priority of priorities) {
    const group = ordered.filter((r) => r.priority === priority);
    let progress = true;
    while (left > 0 && progress) {
      progress = false;
      for (const r of group) {
        if (left === 0) break;
        const g = granted.get(r.endeavourId) ?? 0;
        if (g < r.requested) {
          granted.set(r.endeavourId, g + 1);
          left -= 1;
          progress = true;
        }
      }
    }
  }
  return granted;
}
