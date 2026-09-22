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

/** An address the account may also send as. Aliases share the account's sending limits. */
export interface MailboxAlias {
  address: string;
  displayName: string;
  /** ISO timestamp of when this app created or recorded it. */
  createdAt: string;
}

/** Personal Google accounts cannot hold domain aliases; only Workspace domains can. */
export const PERSONAL_GOOGLE_DOMAINS = new Set(["gmail.com", "googlemail.com"]);

export const domainOf = (address: string) => address.split("@")[1]?.toLowerCase() ?? "";

/**
 * Google accepts a local part of letters, digits and . _ - + ; it must not start or end with
 * a dot. Checked here so a mistake is a sentence rather than a 400 from Google.
 */
export function checkAliasLocalPart(localPart: string): string | null {
  const value = localPart.trim().toLowerCase();
  if (!value) return "give the part before the @";
  if (value.length > 64) return "that is longer than an address can be";
  if (!/^[a-z0-9._+-]+$/.test(value)) return "use letters, digits and . _ - + only";
  if (value.startsWith(".") || value.endsWith(".")) return "it cannot start or end with a dot";
  if (value.includes("..")) return "it cannot contain two dots in a row";
  return null;
}

export interface AliasRequest {
  /** The whole address. Any domain the Workspace holds is allowed, not only the account's own. */
  address: string;
  displayName: string;
}

/** Everything that must be true before Google is asked to create the alias. */
/**
 * Everything that must be true before Google is asked to create the alias.
 *
 * The domain is not required to match the account's own: a Workspace holds several, and an
 * alias may sit on any of them. Google decides whether it holds this one — asking it and
 * reporting its answer beats a guess that refuses a perfectly good address.
 */
export function checkAliasRequest(
  mailbox: { address: string; status: string; aliases: readonly MailboxAlias[] },
  request: AliasRequest,
): { ok: true; address: string; displayName: string } | { ok: false; reason: string } {
  if (mailbox.status !== "connected") return { ok: false, reason: "reconnect this mailbox before adding an alias to it" };

  const address = request.address.trim().toLowerCase();
  const at = address.indexOf("@");
  if (at < 1 || at !== address.lastIndexOf("@")) return { ok: false, reason: "write the whole address, like hello@yourdomain.com" };

  const problem = checkAliasLocalPart(address.slice(0, at));
  if (problem) return { ok: false, reason: problem };

  const domain = address.slice(at + 1);
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(domain)) {
    return { ok: false, reason: "that domain does not look like a domain" };
  }
  if (PERSONAL_GOOGLE_DOMAINS.has(domain)) {
    return { ok: false, reason: "Google does not allow aliases on gmail.com; use a domain your Workspace owns" };
  }
  if (address === mailbox.address.toLowerCase()) return { ok: false, reason: "that is the account's own address" };
  if (mailbox.aliases.some((a) => a.address.toLowerCase() === address)) {
    return { ok: false, reason: "this mailbox already sends as that address" };
  }

  const displayName = request.displayName.trim();
  if (!displayName) return { ok: false, reason: "give the name recipients should see" };
  if (displayName.length > 80) return { ok: false, reason: "that display name is too long" };
  return { ok: true, address, displayName };
}
