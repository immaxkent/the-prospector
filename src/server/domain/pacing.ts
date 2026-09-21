/**
 * When each email actually leaves.
 *
 * Two problems this solves. A batch sent back to back is not how a person writes, and mail
 * providers score it accordingly. And a send timed to the sender's morning lands in the
 * recipient's night if they are five hours west, which is both rude and the worst hour of the
 * day to arrive in.
 *
 * So each approved message is given a slot: inside the recipient's working hours where we know
 * their timezone, inside the mailbox's otherwise, spaced from the one before it by a gap that
 * is never the same twice.
 */

export interface SendWindow {
  /** Local hour the window opens, inclusive (0-23). */
  startHour: number;
  /** Local hour it closes, exclusive (1-24). */
  endHour: number;
}

export interface PacingSettings {
  window: SendWindow;
  /** Gap between consecutive sends from one mailbox, in minutes. */
  minGapMinutes: number;
  maxGapMinutes: number;
  /** Aim at the recipient's working hours when their timezone is known. */
  useRecipientTimezone: boolean;
  /** A reply is never sent sooner than this after their message arrived. */
  minReplyDelayMinutes: number;
}

export const DEFAULT_PACING: PacingSettings = {
  window: { startHour: 8, endHour: 17 },
  minGapMinutes: 4,
  maxGapMinutes: 25,
  useRecipientTimezone: true,
  minReplyDelayMinutes: 90,
};

export const MIN_GAP_FLOOR_MINUTES = 1;
export const MAX_GAP_CEILING_MINUTES = 240;

/** A source of randomness, injected so tests are not at the mercy of it. */
export type Random = () => number;

export function normalisePacing(input: Partial<PacingSettings> | null | undefined): PacingSettings {
  const p = { ...DEFAULT_PACING, ...(input ?? {}) };
  const startHour = clampHour(p.window?.startHour ?? DEFAULT_PACING.window.startHour, 0, 23);
  const endHour = clampHour(p.window?.endHour ?? DEFAULT_PACING.window.endHour, 1, 24);
  const minGap = clamp(Math.round(p.minGapMinutes), MIN_GAP_FLOOR_MINUTES, MAX_GAP_CEILING_MINUTES);
  return {
    // A window that closes before it opens would never send; the default is restored instead.
    window: endHour > startHour ? { startHour, endHour } : { ...DEFAULT_PACING.window },
    minGapMinutes: minGap,
    maxGapMinutes: clamp(Math.round(p.maxGapMinutes), minGap, MAX_GAP_CEILING_MINUTES),
    useRecipientTimezone: p.useRecipientTimezone !== false,
    minReplyDelayMinutes: clamp(Math.round(p.minReplyDelayMinutes), 0, 7 * 24 * 60),
  };
}

const clamp = (n: number, lo: number, hi: number) => (Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo);
const clampHour = (n: number, lo: number, hi: number) => clamp(n, lo, hi);

/** The hour of a moment in a timezone, 0-23. An unknown timezone falls back to UTC. */
export function hourIn(at: Date, timeZone: string) {
  try {
    return Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone }).format(at));
  } catch {
    return at.getUTCHours();
  }
}

/** Whether a timezone name is one this runtime understands, so a bad one never silently shifts a send. */
export function isKnownTimezone(timeZone: string | null | undefined): timeZone is string {
  if (!timeZone) return false;
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone });
    return true;
  } catch {
    return false;
  }
}

export function withinWindow(at: Date, timeZone: string, window: SendWindow) {
  const hour = hourIn(at, timeZone);
  return hour >= window.startHour && hour < window.endHour;
}

/**
 * The first moment at or after `from` that falls inside the window, stepping an hour at a time.
 * Stepping rather than computing the offset keeps daylight saving correct without a date library.
 */
export function nextWindowOpening(from: Date, timeZone: string, window: SendWindow) {
  let at = new Date(from);
  for (let i = 0; i < 48; i++) {
    if (withinWindow(at, timeZone, window)) return at;
    // Move to the top of the next hour, so the search cannot stall inside one.
    at = new Date(Math.floor(at.getTime() / 3_600_000) * 3_600_000 + 3_600_000);
  }
  return at;
}

export interface SlotInput {
  /** Now, or the earliest this particular message may go (a reply's enforced delay). */
  earliest: Date;
  /** When the previous message from this mailbox is scheduled, if any. */
  previousSlot: Date | null;
  /** The recipient's timezone when known. */
  recipientTimezone: string | null;
  /** The mailbox's own timezone, used when the recipient's is unknown or disabled. */
  mailboxTimezone: string;
  pacing: PacingSettings;
  random?: Random;
}

/** The gap before the next send: somewhere between the two bounds, never the same twice. */
export function jitteredGapMs(pacing: PacingSettings, random: Random = Math.random) {
  const span = pacing.maxGapMinutes - pacing.minGapMinutes;
  const minutes = pacing.minGapMinutes + Math.floor(random() * (span + 1));
  return minutes * 60_000;
}

export interface Slot {
  at: Date;
  /** The timezone the window was applied in, so the decision can be explained. */
  timeZone: string;
  usedRecipientTimezone: boolean;
}

/** When this message should go out, given what the mailbox has already lined up. */
export function nextSlot(input: SlotInput): Slot {
  const random = input.random ?? Math.random;
  const useRecipient =
    input.pacing.useRecipientTimezone && isKnownTimezone(input.recipientTimezone);
  const timeZone = useRecipient ? input.recipientTimezone! : input.mailboxTimezone;

  const afterPrevious = input.previousSlot
    ? new Date(input.previousSlot.getTime() + jitteredGapMs(input.pacing, random))
    : input.earliest;
  const notBefore = new Date(Math.max(afterPrevious.getTime(), input.earliest.getTime()));
  return { at: nextWindowOpening(notBefore, timeZone, input.pacing.window), timeZone, usedRecipientTimezone: useRecipient };
}

/** A reply waits at least the configured delay after the message it answers. */
export function earliestReplyAt(inboundAt: Date | null, now: Date, pacing: PacingSettings) {
  if (!inboundAt) return now;
  const earliest = new Date(inboundAt.getTime() + pacing.minReplyDelayMinutes * 60_000);
  return earliest > now ? earliest : now;
}
