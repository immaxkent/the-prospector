/**
 * The morning digest: only what should wake someone.
 *
 * A digest that arrives every day whatever has happened stops being read, and once it
 * stops being read the one that mattered is missed too. So it is sent when there is
 * something to say and withheld when there is not — silence is the signal that nothing
 * needs you.
 *
 * Four things qualify, and they are the four the operator cannot find out any other way
 * without opening the app and going looking.
 */
import type { Notification } from "../notify/channels";

export interface DigestInput {
  endeavourId: string;
  endeavourName: string;
  /** Threads whose newest message is theirs: they answered and nobody has answered back. */
  waitingOnYou: number;
  /** Oldest of those, in whole days. Zero when nothing is waiting. */
  waitingLongestDays: number;
  /** Released prospects whose approved message has not left, which is a mailbox fault. */
  stuckSends: number;
  /** Why prospecting is not running, already in the operator's words. Null when it is. */
  haltNotice: string | null;
  /** The day's model spend is gone, so nothing more will be researched or drafted today. */
  budgetExhausted: boolean;
}

export interface Digest {
  notification: Notification;
  /** The lines, kept separate so the app can render them as a list rather than a paragraph. */
  lines: string[];
}

/**
 * Null when nothing qualifies.
 *
 * Deliberately not "a digest with an empty list". A notification that says nothing is still
 * an interruption, and the operator pays for it in attention every morning.
 */
export function buildDigest(input: DigestInput): Digest | null {
  const lines: string[] = [];

  if (input.waitingOnYou > 0) {
    const oldest =
      input.waitingLongestDays >= 1
        ? `, the oldest ${input.waitingLongestDays} day${input.waitingLongestDays === 1 ? "" : "s"} ago`
        : "";
    const who = input.waitingOnYou === 1 ? "1 person has replied and is" : `${input.waitingOnYou} people have replied and are`;
    lines.push(`${who} waiting on you${oldest}.`);
  }

  // A fault, not a workload: these are messages the operator already approved, which the
  // system then failed to send. It reads differently from everything else here.
  if (input.stuckSends > 0) {
    lines.push(
      `${input.stuckSends} approved message${input.stuckSends === 1 ? "" : "s"} did not go out. That is the mailbox, not you — check it is still connected.`,
    );
  }

  if (input.haltNotice) lines.push(input.haltNotice);

  if (input.budgetExhausted) {
    lines.push("The day's model budget is spent, so nothing further will be researched or drafted today.");
  }

  if (lines.length === 0) return null;

  return {
    lines,
    notification: {
      kind: "daily_digest",
      title: `${input.endeavourName} · ${lines.length} thing${lines.length === 1 ? "" : "s"} this morning`,
      body: lines.join("\n"),
      endeavourId: input.endeavourId,
      path: `/endeavours/${input.endeavourId}`,
      // People waiting is the only one that is someone else's time rather than the
      // operator's own. Everything else can sit until they look.
      priority: input.waitingOnYou > 0 ? "high" : "normal",
    },
  };
}
