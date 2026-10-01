/**
 * The weekly review: what the system needs from the operator, and what it learned.
 *
 * Nothing leaves the pending buffer on its own — dequeuing is the operator's decision — so
 * this is how the system asks. Three sections it wants acted on and one it wants read.
 *
 * The lists are queried, not generated. Only the covering sentence is written by a model,
 * and it is given the figures rather than asked to recall them: a review that quietly
 * invents a number is worse than no review, because the operator has no way to tell.
 */
import type { Notification } from "../notify/channels";

export interface ReviewItem {
  prospectId: string;
  company: string;
  /** Whole days since whatever makes this item wait: a reply, a release, a last word. */
  days: number;
}

export interface SegmentNews {
  name: string;
  pending: number;
  share: number;
  sent: number;
  replies: number;
}

export interface AllocationState {
  mode: "even" | "automatic";
  /** True once every segment has enough sends for the weighting to act. */
  armed: boolean;
  /** Sends still needed before it can, across every segment short of the sample. */
  shortBy: number;
  /** Best and worst reply rate among segments that have a sample. Null when none have. */
  spread: { best: string; bestRate: number; worst: string; worstRate: number } | null;
}

/** A difference worth switching for: anything less is within the noise of these samples. */
export interface ReviewFacts {
  endeavourId: string;
  endeavourName: string;
  followUp: ReviewItem[];
  decide: ReviewItem[];
  silent: ReviewItem[];
  offChannel: ReviewItem[];
  segments: SegmentNews[];
  pending: number;
  pendingCap: number;
  active: number;
  activeGoal: number;
  /** Below this many sends, a per-segment rate is not worth reading. */
  minSample: number;
  /**
   * Set when the setpoints cannot reach the objective. The setpoints are about capacity and
   * know nothing about the goal, so without this a perfectly healthy endeavour sits at its
   * numbers while the deadline goes past.
   */
  objectiveWarning: string | null;
  /** Which setting is on, and whether it can act yet. Printed in the header. */
  allocation: AllocationState;
}

export interface Review {
  notification: Notification;
  sections: { title: string; lines: string[] }[];
}

/** Longest-waiting first: the oldest thing is the one most likely to have gone cold. */
const oldestFirst = (items: readonly ReviewItem[]) => [...items].sort((a, b) => b.days - a.days);

const ago = (days: number) => (days < 1 ? "today" : `${days} day${days === 1 ? "" : "s"}`);

/** At most this many named, then a count. A list nobody can read is not a list. */
export const NAMED_LIMIT = 8;

function listOf(items: readonly ReviewItem[], suffix: (item: ReviewItem) => string): string[] {
  const sorted = oldestFirst(items);
  const lines = sorted.slice(0, NAMED_LIMIT).map((item) => `· ${item.company} — ${suffix(item)}`);
  if (sorted.length > NAMED_LIMIT) lines.push(`· and ${sorted.length - NAMED_LIMIT} more`);
  return lines;
}

/**
 * How a segment's figures read when there is not enough of them to mean anything.
 *
 * A reply rate off nine sends is noise, and printing it as a percentage invites the
 * operator to act on it. The sample size goes beside every rate for the same reason.
 */
export function segmentLine(segment: SegmentNews, minSample: number): string {
  const share = `${segment.pending}/${segment.share} held`;
  if (segment.sent === 0) return `· ${segment.name} — ${share}, nothing sent yet`;
  if (segment.sent < minSample) {
    return `· ${segment.name} — ${share}, ${segment.replies} repl${segment.replies === 1 ? "y" : "ies"} from ${segment.sent} sent (too few to rate)`;
  }
  const rate = Math.round((segment.replies / segment.sent) * 100);
  return `· ${segment.name} — ${share}, ${rate}% reply rate from ${segment.sent} sent`;
}

export function buildReview(facts: ReviewFacts, covering: string): Review {
  const sections: { title: string; lines: string[] }[] = [];

  if (facts.followUp.length) {
    sections.push({
      title: "FOLLOW UP WITH THESE",
      lines: listOf(facts.followUp, (item) => `replied ${ago(item.days)} ago, waiting on you`),
    });
  }
  if (facts.decide.length) {
    sections.push({
      title: "APPROVE OR REJECT THESE",
      lines: listOf(facts.decide, (item) => `found ${ago(item.days)} ago, nothing written yet`),
    });
  }

  // One section, because they are one question to the operator: is this still alive?
  const update = [
    ...facts.silent.map((item) => ({ ...item, why: `silent ${ago(item.days)}` })),
    ...facts.offChannel.map((item) => ({ ...item, why: `in talks elsewhere, nothing logged for ${ago(item.days)}` })),
  ];
  if (update.length) {
    sections.push({
      title: "UPDATE ON THESE",
      lines: listOf(update, (item) => (item as ReviewItem & { why: string }).why),
    });
  }

  sections.push({
    title: "NEWS",
    lines: [
      `· ${facts.pending}/${facts.pendingCap} pending · ${facts.active}/${facts.activeGoal} live conversations`,
      // First after the setpoints, because it is about them: a reader who takes those two
      // numbers as healthy needs to know immediately that they are not enough.
      ...(facts.objectiveWarning ? [`· ${facts.objectiveWarning}`] : []),
      ...facts.segments.map((segment) => segmentLine(segment, facts.minSample)),
    ],
  });

  const asks = sections.filter((s) => s.title !== "NEWS").reduce((sum, s) => sum + s.lines.length, 0);
  // The allocation note sits in the header rather than in NEWS: every share below is read
  // differently depending on which setting is on, so it has to come first.
  const body = [covering, "", allocationNote(facts.allocation), "", ...sections.flatMap((s) => [s.title, ...s.lines, ""])]
    .join("\n")
    .trimEnd();

  return {
    sections,
    notification: {
      kind: "weekly_review",
      title: `${facts.endeavourName} · this week${asks ? `, ${asks} thing${asks === 1 ? "" : "s"} for you` : ""}`,
      body,
      endeavourId: facts.endeavourId,
      path: `/endeavours/${facts.endeavourId}`,
      priority: "normal",
    },
  };
}

/**
 * What the covering sentence says when there is no model to write it.
 *
 * Deliberately flat. The alternative — withholding the review because the prose is missing
 * — would lose the lists, which are the part that matters.
 */
export function plainCovering(facts: ReviewFacts): string {
  const asks = facts.followUp.length + facts.decide.length + facts.silent.length + facts.offChannel.length;
  if (asks === 0) return "Nothing is waiting on you this week.";
  return `${asks} thing${asks === 1 ? "" : "s"} need you this week.`;
}

/* ---------- how the buffer is being divided, and whether that is right ---------- */

export const WORTH_SWITCHING_RATIO = 2;

/**
 * What the review says about the split, in the header.
 *
 * Two jobs. It states which setting is on, because an operator who has forgotten cannot
 * read any of the figures below correctly. And it advises — but only when the evidence
 * actually supports the advice, which is the whole difficulty: a recommendation to switch,
 * given off a sample too small to rank segments, would be the exact mistake the automatic
 * mode is built to avoid, delivered by the thing that warns about it.
 */
export function allocationNote(state: AllocationState): string {
  if (state.mode === "automatic") {
    if (state.armed) {
      const lead = state.spread
        ? ` ${state.spread.best} is replying best and holds the larger share.`
        : "";
      return `The buffer is weighted by reply rate.${lead}`;
    }
    return `The buffer is set to weight by reply rate, but is still split evenly: ${state.shortBy} more send${state.shortBy === 1 ? "" : "s"} are needed before any segment can be ranked.`;
  }

  if (!state.armed || !state.spread) {
    return "The buffer is split evenly between segments. There is not yet enough sent to rank them, so that is the honest split.";
  }
  if (state.spread.worstRate > 0 && state.spread.bestRate / state.spread.worstRate >= WORTH_SWITCHING_RATIO) {
    const best = Math.round(state.spread.bestRate * 100);
    const worst = Math.round(state.spread.worstRate * 100);
    return `The buffer is split evenly. ${state.spread.best} is replying at ${best}% against ${state.spread.worst} at ${worst}% — worth switching to weight by reply rate if you want more of the buffer going where it is landing.`;
  }
  if (state.spread.worstRate === 0 && state.spread.bestRate > 0) {
    const best = Math.round(state.spread.bestRate * 100);
    return `The buffer is split evenly. ${state.spread.best} is replying at ${best}% and ${state.spread.worst} at nothing at all — worth switching to weight by reply rate.`;
  }
  return "The buffer is split evenly, and the segments are replying at much the same rate, so there is nothing to be gained by weighting it.";
}
