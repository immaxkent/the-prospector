/**
 * What state a prospect is in, and whether it is waiting on a person.
 *
 * Every screen that shows a prospect was deciding this for itself off `stage`, `status`,
 * `score` and `releasedAt` — four fields that overlap — so the same prospect could read as
 * qualified on one screen and as waiting on another. This is the one derivation they all use.
 *
 * The roadmap names three states: not yet judged, judged and waiting on you, judged and not
 * worth it. There is a fourth here because a released prospect is none of those: the decision
 * has been made and the agent has it, so it is off the operator's desk without being refused.
 */
import { isGenericInbox } from "@/server/domain/contacts";
import type { Prospect } from "./types";

export type ProspectState = "unjudged" | "undecided" | "accepted" | "declined";

/** How reachable they are, worst to best: nothing, a handle a person can open, an inbox, a named address. */
export type Reach = "none" | "handle" | "inbox" | "named";

export interface ProspectDecision {
  state: ProspectState;
  /** Why it is in that state, short enough to sit beside a row. */
  reason: string;
  /** Whether the operator has something to do here. */
  needsDecision: boolean;
  reach: Reach;
  /** What they can be reached on, said plainly. */
  reachNote: string;
}

/** The order the operator should meet these in: what needs them, then what is coming, then what is done. */
const STATE_RANK: Record<ProspectState, number> = { undecided: 0, unjudged: 1, accepted: 2, declined: 3 };

const HANDLE_CHANNELS = new Set(["discord", "telegram", "x", "linkedin", "form", "other"]);

export function reachOf(contacts: readonly { channel: string; value: string }[]): Reach {
  const emails = contacts.filter((c) => c.channel === "email" && c.value.trim() !== "");
  if (emails.some((c) => !isGenericInbox(c.value))) return "named";
  if (emails.length > 0) return "inbox";
  if (contacts.some((c) => HANDLE_CHANNELS.has(c.channel) && c.value.trim() !== "")) return "handle";
  return "none";
}

const REACH_NOTE: Record<Reach, string> = {
  named: "named address",
  inbox: "generic inbox",
  handle: "handle only — you open it",
  none: "no route found",
};

/** True when there is nothing this app can send to, whatever a person might manage by hand. */
export const cannotBeContacted = (reach: Reach) => reach === "none";

export function prospectDecision(p: Prospect): ProspectDecision {
  const reach = reachOf(p.contacts);
  const reachNote = REACH_NOTE[reach];
  const decided = (state: ProspectState, reason: string): ProspectDecision => ({
    state,
    reason,
    needsDecision: state === "undecided",
    reach,
    reachNote,
  });

  if (p.status === "REJECTED") {
    return decided("declined", p.scoreReason ? `rejected — ${p.scoreReason}` : "rejected");
  }
  if (p.releasedAt) return decided("accepted", "released — the agent has it");
  if (p.status === "DISCOVERED") return decided("unjudged", "found, not looked at yet");
  if (p.status === "RESEARCHING") return decided("unjudged", "being researched");
  if (p.score === null) return decided("unjudged", "researched, not scored yet");
  if (p.status === "NEEDS_REVIEW") return decided("undecided", "flagged for review");
  if (reach === "none") return decided("undecided", `scored ${p.score}, but no route to reach them`);
  return decided("undecided", `scored ${p.score}, waiting on you`);
}

const REACH_RANK: Record<Reach, number> = { named: 0, inbox: 1, handle: 2, none: 3 };

/**
 * The list in the order a person should work it.
 *
 * What needs a decision comes first, and within that the ones that can actually be reached —
 * a high score with no route to the company is not the first thing to spend attention on.
 * Sorting is stable, so rows that tie keep whatever order they arrived in.
 */
export function orderByDecision<T extends Prospect>(prospects: readonly T[]): (T & { decision: ProspectDecision })[] {
  return prospects
    .map((p) => ({ ...p, decision: prospectDecision(p) }))
    .sort((a, b) => {
      const byState = STATE_RANK[a.decision.state] - STATE_RANK[b.decision.state];
      if (byState !== 0) return byState;
      if (a.decision.state === "undecided") {
        // Flagged for review is the most explicit ask there is, so it goes above score.
        const flagged = Number(b.status === "NEEDS_REVIEW") - Number(a.status === "NEEDS_REVIEW");
        if (flagged !== 0) return flagged;
        const byReach = REACH_RANK[a.decision.reach] - REACH_RANK[b.decision.reach];
        if (byReach !== 0) return byReach;
        return (b.score ?? 0) - (a.score ?? 0);
      }
      if (a.decision.state === "accepted") return (b.releasedAt ?? "").localeCompare(a.releasedAt ?? "");
      return 0;
    });
}

export interface DecisionCount {
  needsDecision: number;
  unjudged: number;
  accepted: number;
  declined: number;
  /** Of the ones needing a decision, how many have no route to the company. */
  unreachable: number;
}

export function countDecisions(prospects: readonly Prospect[]): DecisionCount {
  const count: DecisionCount = { needsDecision: 0, unjudged: 0, accepted: 0, declined: 0, unreachable: 0 };
  for (const p of prospects) {
    const d = prospectDecision(p);
    if (d.state === "undecided") {
      count.needsDecision += 1;
      if (cannotBeContacted(d.reach)) count.unreachable += 1;
    } else if (d.state === "unjudged") count.unjudged += 1;
    else if (d.state === "accepted") count.accepted += 1;
    else count.declined += 1;
  }
  return count;
}
