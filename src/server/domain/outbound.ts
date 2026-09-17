/**
 * Outbound message lifecycle. Every state is explicit so no send can fail silently.
 *
 * drafted → pending_approval → approved → queued → sending → sent
 *                            ↘ rejected            ↘ failed → queued (retry)
 * Autonomy decides whether drafted goes to pending_approval or straight to approved.
 */
import type { AutonomyLevel } from "./endeavour-spec";

export const OUTBOUND_STATES = [
  "drafted",
  "pending_approval",
  "approved",
  "rejected",
  "queued",
  "sending",
  "sent",
  "failed",
] as const;

export type OutboundState = (typeof OUTBOUND_STATES)[number];

const NEXT: Record<OutboundState, readonly OutboundState[]> = {
  drafted: ["pending_approval", "approved"],
  pending_approval: ["approved", "rejected"],
  approved: ["queued"],
  rejected: [],
  queued: ["sending"],
  sending: ["sent", "failed"],
  sent: [],
  failed: ["queued"],
};

export const MAX_SEND_ATTEMPTS = 3;

export function canMove(from: OutboundState, to: OutboundState) {
  return NEXT[from].includes(to);
}

export class OutboundTransitionError extends Error {
  constructor(
    readonly from: OutboundState,
    readonly to: OutboundState,
  ) {
    super(`outbound message cannot move from ${from} to ${to}`);
  }
}

export function assertMove(from: OutboundState, to: OutboundState) {
  if (!canMove(from, to)) throw new OutboundTransitionError(from, to);
}

export function canRetry(state: OutboundState, attempts: number) {
  return state === "failed" && attempts < MAX_SEND_ATTEMPTS;
}

export type MessageClass = "new_outreach" | "follow_up" | "reply";

export interface ApprovalInput {
  autonomyLevel: AutonomyLevel;
  messageClass: MessageClass;
  /** Copy that has not been approved before in this endeavour. */
  novelCopy: boolean;
  /** Price concessions, commitments, sensitive claims or unusual replies. */
  sensitive: boolean;
}

/**
 * Where a fresh draft goes next.
 * OBSERVE never drafts for sending; DRAFT always needs a human.
 * GUARDED and DELEGATED are modelled here but blocked from activation in v1.
 */
export function routeDraft(input: ApprovalInput): "discard" | "pending_approval" | "approved" {
  if (input.autonomyLevel === "OBSERVE") return "discard";
  if (input.sensitive) return "pending_approval";
  switch (input.autonomyLevel) {
    case "DRAFT":
      return "pending_approval";
    case "GUARDED":
      return input.novelCopy || input.messageClass === "reply" ? "pending_approval" : "approved";
    case "DELEGATED":
      return "approved";
  }
}
