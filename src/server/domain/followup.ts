/**
 * Follow-up cadence. A follow-up is due a set number of days after the last message we sent,
 * and the sequence stops the moment the prospect replies, is closed, or the sequence is spent.
 */
export const DEFAULT_FOLLOWUP_DAYS = [3, 7, 14] as const;

export type FollowUpDecision =
  | { due: true; attempt: number }
  | { due: false; reason: "replied" | "closed" | "sequence_finished" | "not_contacted" | "too_soon" | "none_sent"; nextDueAt: Date | null };

export interface FollowUpInput {
  stage: string;
  reviewStatus: string;
  /** When we last sent them anything. */
  lastOutboundAt: Date | null;
  /** When they last wrote back, if ever. */
  lastInboundAt: Date | null;
  /** Follow-ups already sent or drafted in this sequence. */
  followUpsSoFar: number;
  now: Date;
  cadenceDays?: readonly number[];
}

const CLOSED_STAGES = new Set(["won", "lost", "nurture"]);

/** When the next follow-up falls due, or null when the sequence is finished. */
export function nextFollowUpAt(lastOutboundAt: Date, followUpsSoFar: number, cadenceDays: readonly number[] = DEFAULT_FOLLOWUP_DAYS) {
  const days = cadenceDays[followUpsSoFar];
  return days === undefined ? null : new Date(lastOutboundAt.getTime() + days * 86_400_000);
}

export function decideFollowUp(input: FollowUpInput): FollowUpDecision {
  const cadence = input.cadenceDays ?? DEFAULT_FOLLOWUP_DAYS;
  if (input.reviewStatus === "rejected" || CLOSED_STAGES.has(input.stage)) return { due: false, reason: "closed", nextDueAt: null };
  if (input.lastInboundAt) return { due: false, reason: "replied", nextDueAt: null };
  if (input.stage !== "contacted") return { due: false, reason: "not_contacted", nextDueAt: null };
  if (!input.lastOutboundAt) return { due: false, reason: "none_sent", nextDueAt: null };

  const dueAt = nextFollowUpAt(input.lastOutboundAt, input.followUpsSoFar, cadence);
  if (!dueAt) return { due: false, reason: "sequence_finished", nextDueAt: null };
  if (dueAt > input.now) return { due: false, reason: "too_soon", nextDueAt: dueAt };
  return { due: true, attempt: input.followUpsSoFar + 1 };
}

/** True when the sequence has run out and the prospect should be parked rather than chased. */
export function sequenceFinished(followUpsSoFar: number, cadenceDays: readonly number[] = DEFAULT_FOLLOWUP_DAYS) {
  return followUpsSoFar >= cadenceDays.length;
}
