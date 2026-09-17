import type { Endeavour, Health, PipelineStage as ViewStage } from "@/data/types";
import type { EndeavourSpec, FieldState } from "../domain/endeavour-spec";
import { PROGRESSION } from "../domain/pipeline";
import {
  daysBetween,
  iso,
  sameLocalDay,
  type ApprovalRow,
  type EndeavourRow,
  type InsightRow,
  type MessageRow,
  type OpportunityRow,
  type ProspectRow,
  type RunRow,
} from "./rows";

export interface EndeavourInputs {
  endeavour: EndeavourRow;
  prospects: readonly ProspectRow[];
  opportunities: readonly OpportunityRow[];
  messages: readonly MessageRow[];
  approvals: readonly ApprovalRow[];
  runs: readonly RunRow[];
  insights: readonly InsightRow[];
  now: Date;
}

const value = <T>(f: FieldState<T>) => (f.state === "stated" || f.state === "confirmed" ? f.value : undefined);

const PERIOD_DAYS = { week: 7, month: 30, quarter: 91 } as const;

function periodEnd(start: Date, period: keyof typeof PERIOD_DAYS, now: Date) {
  const len = PERIOD_DAYS[period] * 86_400_000;
  const elapsed = Math.max(0, now.getTime() - start.getTime());
  return new Date(start.getTime() + (Math.floor(elapsed / len) + 1) * len);
}

export function objectiveText(spec: EndeavourSpec) {
  const o = value(spec.objective);
  if (!o) return "Objective not set";
  if (o.metric === "revenue") {
    const amount = new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: o.currency ?? "GBP",
      maximumFractionDigits: 0,
    }).format(o.target);
    return `Generate ${amount} in revenue`;
  }
  return `Reach ${new Intl.NumberFormat("en-GB").format(o.target)} ${o.unit}`;
}

/** Progress is on track when the share of target achieved keeps pace with the share of time elapsed. */
export function healthFor(status: EndeavourRow["status"], progress: number, elapsed: number): Health {
  if (status === "paused" || status === "archived" || status === "draft") return "PAUSED";
  if (elapsed <= 0 || progress >= elapsed) return "ON_TRACK";
  return progress >= elapsed * 0.6 ? "AT_RISK" : "BEHIND";
}

const OPEN_STAGES = new Set(["discovered", "researched", "qualified", "contacted", "replied", "meeting", "proposal"]);

export function buildEndeavour(input: EndeavourInputs): Endeavour {
  const { endeavour: e, now } = input;
  const spec = e.spec;
  const objective = value(spec.objective);
  const horizon = value(spec.horizon);
  const offering = value(spec.offering);
  const pricing = value(spec.pricing);
  const buyers = value(spec.buyers) ?? [];
  const cadence = value(spec.cadence) ?? { dailyNewTarget: 0, dailyFollowupTarget: 0 };
  const isRevenue = objective?.metric === "revenue";
  const start = e.activatedAt ?? e.createdAt;

  const active = input.prospects.filter((p) => p.reviewStatus !== "rejected");
  const won = active.filter((p) => p.stage === "won");
  const actualValue = isRevenue
    ? input.opportunities.filter((o) => o.stage === "won").reduce((s, o) => s + o.value, 0)
    : won.length;
  const pipelineValue = isRevenue
    ? input.opportunities.filter((o) => OPEN_STAGES.has(o.stage)).reduce((s, o) => s + o.value, 0)
    : active.filter((p) => p.stage === "meeting" || p.stage === "proposal").length;

  let deadline: Date;
  let horizonDays: number;
  let period: Endeavour["period"] = null;
  if (horizon?.kind === "ongoing") {
    period = horizon.period;
    horizonDays = PERIOD_DAYS[horizon.period];
    deadline = periodEnd(start, horizon.period, now);
  } else {
    deadline = horizon ? new Date(`${horizon.endsOn}T23:59:59Z`) : now;
    horizonDays = Math.max(0, daysBetween(start, deadline));
  }

  const target = objective?.target ?? 0;
  const totalMs = horizonDays * 86_400_000;
  const periodStart = new Date(deadline.getTime() - totalMs);
  const elapsed = totalMs > 0 ? Math.min(1, (now.getTime() - periodStart.getTime()) / totalMs) : 0;
  const health = healthFor(e.status, target > 0 ? actualValue / target : 0, elapsed);

  // Funnel counts every prospect that has reached at least each stage.
  const funnel = Object.fromEntries(
    PROGRESSION.map((stage, i) => [
      stage,
      active.filter((p) => {
        const idx = PROGRESSION.indexOf(p.stage);
        return idx >= i;
      }).length,
    ]),
  ) as Record<ViewStage, number>;
  funnel.lost = active.filter((p) => p.stage === "lost").length;
  funnel.nurture = active.filter((p) => p.stage === "nurture").length;

  const sentToday = (cls: MessageRow["messageClass"]) =>
    input.messages.filter((m) => m.direction === "outbound" && m.messageClass === cls && sameLocalDay(m.sentAt, now))
      .length;

  const pending = input.approvals
    .filter((a) => a.status === "pending")
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const due = active
    .filter((p) => p.nextAction && p.nextActionAt)
    .sort((a, b) => a.nextActionAt!.getTime() - b.nextActionAt!.getTime());
  const nextCriticalAction = pending[0]
    ? `Approval waiting: ${pending[0].kind.replace(/_/g, " ")}`
    : (due[0]?.nextAction ?? "No action due");

  const lastRun = [...input.runs].sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())[0];
  const hypothesis = input.insights.find((i) => i.type === "recommendation" && i.status !== "dismissed");

  return {
    id: e.id,
    name: e.name,
    kind: e.kind,
    status: e.status,
    mailboxId: e.mailboxId,
    objective: objectiveText(spec),
    unit: isRevenue ? "GBP" : "COUNT",
    targetValue: target,
    actualValue,
    pipelineValue,
    deadline: iso(deadline).slice(0, 10),
    horizonDays,
    period,
    health,
    autonomy: e.autonomyLevel,
    audienceNotes: buyers.map((b) => `${b.name}: ${b.definition}`).join(" · "),
    offerNotes: [offering?.summary, pricing?.amount ? `${pricing.currency ?? ""} ${pricing.amount} ${pricing.model}`.trim() : null]
      .filter(Boolean)
      .join(" · "),
    channels: ["EMAIL"],
    dailyOutreachTarget: cadence.dailyNewTarget,
    dailyFollowupTarget: cadence.dailyFollowupTarget,
    quota: {
      newProspects: cadence.dailyNewTarget,
      outreach: cadence.dailyNewTarget,
      followups: cadence.dailyFollowupTarget,
    },
    quotaDone: {
      newProspects: active.filter((p) => p.reviewStatus === "qualified" && sameLocalDay(p.createdAt, now)).length,
      outreach: sentToday("new_outreach"),
      followups: sentToday("follow_up"),
    },
    funnel,
    qualifiedToday: active.filter((p) => p.reviewStatus === "qualified" && sameLocalDay(p.updatedAt, now)).length,
    repliesToday: input.messages.filter((m) => m.direction === "inbound" && sameLocalDay(m.receivedAt, now)).length,
    nextCriticalAction,
    lastRunAt: iso(lastRun?.startedAt),
    strategy: {
      icp: buyers[0]?.definition ?? "",
      offer: offering?.summary ?? "",
      hypothesis: hypothesis?.statement ?? "",
    },
  };
}
