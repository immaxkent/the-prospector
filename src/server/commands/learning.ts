/**
 * Learning. Every insight carries the numbers behind it, and nothing is recommended from a
 * sample too small to mean anything (handoff §8).
 */
import { and, eq } from "drizzle-orm";
import type { ObjectionCluster } from "@/data/types";
import type { Database } from "../db/client";
import { insights } from "../db/schema";
import { newId } from "../ids";
import { MIN_SAMPLE, type PerformanceCut } from "../read/performance";
import { recordEvent } from "./events";

export interface InsightProposal {
  type: "observation" | "recommendation" | "objection" | "signal";
  statement: string;
  evidence: Record<string, unknown>;
  confidence: number;
}

const DIMENSION_WORDS: Record<PerformanceCut["dimension"], string> = {
  segment: "segment",
  trigger: "trigger",
  source: "source",
  message_version: "message version",
};

const rate = (part: number, whole: number) => (whole === 0 ? 0 : part / whole);
const asFraction = (part: number, whole: number) => `${part}/${whole}`;

/** A repeated objection is a commercial signal, not just a complaint. */
export const OBJECTION_SIGNAL_THRESHOLD = 3;

export function proposeInsights(
  cuts: readonly PerformanceCut[],
  objections: readonly ObjectionCluster[],
  options: { minSample?: number } = {},
): InsightProposal[] {
  const minSample = options.minSample ?? MIN_SAMPLE;
  const proposals: InsightProposal[] = [];

  const total = cuts.filter((c) => c.dimension === "segment").reduce(
    (acc, c) => ({ sent: acc.sent + c.sent, positive: acc.positive + c.positiveReplies, wins: acc.wins + c.wins }),
    { sent: 0, positive: 0, wins: 0 },
  );
  if (total.sent >= minSample) {
    proposals.push({
      type: "observation",
      statement: `${asFraction(total.positive, total.sent)} emails drew a positive reply (${Math.round(rate(total.positive, total.sent) * 100)}%).`,
      evidence: { sent: total.sent, positiveReplies: total.positive, wins: total.wins },
      confidence: 0.9,
    });
  }

  for (const dimension of ["segment", "trigger", "source", "message_version"] as const) {
    const eligible = cuts.filter((c) => c.dimension === dimension && c.sent >= minSample);
    if (eligible.length < 2) continue;
    const ranked = [...eligible].sort((a, b) => rate(b.positiveReplies, b.sent) - rate(a.positiveReplies, a.sent));
    const best = ranked[0]!;
    const worst = ranked[ranked.length - 1]!;
    const bestRate = rate(best.positiveReplies, best.sent);
    const worstRate = rate(worst.positiveReplies, worst.sent);
    // Twice the rate and at least ten points apart: anything less is noise at these volumes.
    if (bestRate < worstRate * 2 || bestRate - worstRate < 0.1) continue;
    proposals.push({
      type: "recommendation",
      statement: `${DIMENSION_WORDS[dimension]} "${best.label}" produced ${asFraction(best.positiveReplies, best.sent)} positive replies against ${asFraction(worst.positiveReplies, worst.sent)} for "${worst.label}": send more to "${best.label}".`,
      evidence: {
        dimension,
        best: { label: best.label, sent: best.sent, positiveReplies: best.positiveReplies },
        worst: { label: worst.label, sent: worst.sent, positiveReplies: worst.positiveReplies },
      },
      confidence: Math.min(0.9, 0.5 + (best.sent + worst.sent) / 200),
    });
  }

  for (const cluster of objections) {
    if (cluster.count < OBJECTION_SIGNAL_THRESHOLD) continue;
    proposals.push({
      type: "signal",
      statement: `"${cluster.label}" has come back ${cluster.count} times: answer it in the first email or change the offer.`,
      evidence: { objection: cluster.label, count: cluster.count, example: cluster.example },
      confidence: 0.7,
    });
  }

  return proposals;
}

/** Stores new insights, leaving an identical open one alone so the list does not fill with repeats. */
export async function recordInsights(db: Database, endeavourId: string, proposals: readonly InsightProposal[]) {
  const open = await db
    .select({ statement: insights.statement })
    .from(insights)
    .where(and(eq(insights.endeavourId, endeavourId), eq(insights.status, "open")));
  const seen = new Set(open.map((i) => i.statement));

  const created: string[] = [];
  for (const proposal of proposals) {
    if (seen.has(proposal.statement)) continue;
    const id = newId("insight");
    await db.insert(insights).values({
      id,
      endeavourId,
      type: proposal.type,
      statement: proposal.statement,
      evidence: proposal.evidence,
      confidence: proposal.confidence,
    });
    seen.add(proposal.statement);
    created.push(id);
    if (proposal.type === "signal") {
      await recordEvent(db, {
        eventType: "commercial.signal.detected",
        entityType: "endeavour",
        entityId: endeavourId,
        endeavourId,
        detail: proposal.statement,
        data: proposal.evidence,
      });
    }
  }
  return { created };
}
