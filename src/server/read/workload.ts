/**
 * What the objective arithmetic needs, gathered from the database.
 *
 * Extracted because two things ask the same question and must get the same answer: the
 * daily run, deciding how much work today justifies, and the weekly review, deciding
 * whether the operator's setpoints can reach the objective at all. Computing it twice would
 * let them disagree, and an operator reading both would have no way to tell which was right.
 */
import { eq } from "drizzle-orm";
import type { Database } from "../db/client";
import { endeavours, mailboxes, messages, opportunities, prospects } from "../db/schema";
import { effectiveDailyCap } from "../domain/mailbox";
import { planWorkload, rateObservations, type Workload } from "../domain/workload";
import { DEFAULT_STAGE_PROBABILITY } from "./pipeline";
import { localDate } from "./rows";
import { notFound } from "../commands/errors";

export interface WorkloadFor extends Workload {
  /** What one win is worth, on the same evidence the plan used. */
  dealValue: number;
}

/** The spec fields the arithmetic reads, with the unstated ones left undefined. */
async function endeavourBrief(db: Database, endeavourId: string) {
  const [e] = await db.select().from(endeavours).where(eq(endeavours.id, endeavourId));
  if (!e) throw notFound("endeavour");
  const value = <T>(f: { state: string } & Record<string, unknown>) =>
    f.state === "stated" || f.state === "confirmed" ? (f["value"] as T) : undefined;
  const cadence = value<{ dailyNewTarget: number; dailyFollowupTarget: number }>(e.spec.cadence);
  return { endeavour: e, dailyNewTarget: cadence?.dailyNewTarget ?? 0 };
}

export async function planWorkloadFor(db: Database, endeavourId: string, now: Date): Promise<WorkloadFor> {
  const { endeavour, dailyNewTarget } = await endeavourBrief(db, endeavourId);
  const value = <T>(f: { state: string } & Record<string, unknown>) =>
    f.state === "stated" || f.state === "confirmed" ? (f["value"] as T) : undefined;
  const objective = value<{ metric: string; target: number }>(endeavour.spec.objective);
  const pricing = value<{ amount?: number; expectedDeal?: number; minimumDeal?: number }>(endeavour.spec.pricing);
  const horizon = value<{ kind: string; endsOn?: string }>(endeavour.spec.horizon);

  const own = await db.select().from(prospects).where(eq(prospects.endeavourId, endeavourId));
  const live = own.filter((p) => p.reviewStatus !== "rejected" && p.stage !== "won" && p.stage !== "lost");
  const byStage = new Map<string, number>();
  for (const p of live) byStage.set(p.stage, (byStage.get(p.stage) ?? 0) + 1);

  const opportunityRows = await db.select().from(opportunities).where(eq(opportunities.endeavourId, endeavourId));
  const wonDeals = opportunityRows.filter((o) => o.stage === "won");

  /**
   * An objective counted in partnerships or customers is not measured in money: each win is
   * worth exactly one, and there is no price to forecast from. Only revenue reasons in value.
   */
  const counted = objective?.metric !== "revenue";
  const wonValue = counted ? own.filter((p) => p.stage === "won").length : wonDeals.reduce((sum, o) => sum + o.value, 0);

  // Evidence first: what deals actually turned out to be worth beats any estimate of them.
  const deal = wonDeals.length
    ? { value: wonValue / wonDeals.length, source: "measured" as const }
    : pricing?.expectedDeal
      ? { value: pricing.expectedDeal, source: "expected" as const }
      : pricing?.amount
        ? { value: pricing.amount, source: "fixed" as const }
        : pricing?.minimumDeal
          ? { value: pricing.minimumDeal, source: "minimum" as const }
          : { value: 0, source: "expected" as const };

  const messageRows = await db.select().from(messages).where(eq(messages.endeavourId, endeavourId));

  // Days left in the sprint; an ongoing endeavour is paced a review period at a time.
  const endsOn = horizon?.kind === "sprint" ? horizon.endsOn : undefined;
  const daysRemaining = endsOn
    ? Math.max(1, Math.ceil((new Date(`${endsOn}T23:59:59Z`).getTime() - now.getTime()) / 86_400_000))
    : 30;

  const [mailbox] = endeavour.mailboxId
    ? await db.select().from(mailboxes).where(eq(mailboxes.id, endeavour.mailboxId))
    : [];
  const capacityToday = mailbox ? effectiveDailyCap(mailbox.limits, localDate(now, mailbox.limits.timezone)) : dailyNewTarget;

  const workload = planWorkload({
    unit: counted ? "count" : "money",
    objectiveValue: objective?.target ?? 0,
    wonValue,
    dealValue: counted ? 1 : deal.value,
    ...(counted ? {} : { dealValueSource: deal.source }),
    pipeline: [...byStage.entries()].map(([stage, count]) => ({
      count,
      probability: DEFAULT_STAGE_PROBABILITY[stage as keyof typeof DEFAULT_STAGE_PROBABILITY] ?? 0,
    })),
    // Counted over prospects this endeavour actually emailed. See rateObservations.
    observed: rateObservations(own, messageRows),
    dailyCeiling: dailyNewTarget,
    capacityToday,
    daysRemaining,
  });

  // The deal value comes back with it because the objective warning needs it and nothing
  // else recomputes it: two places deciding separately what a deal is worth would drift.
  return { ...workload, dealValue: counted ? 1 : deal.value };
}

