/**
 * The headline numbers an endeavour can show.
 *
 * Which four matter is not something this file can know — a partnership endeavour does not
 * care about revenue, and a sprint that has not sent anything yet does not care about reply
 * rate. So every number an endeavour has is offered, the operator picks four, and the page
 * shows those.
 *
 * Each tile computes from the dataset the screen already holds; nothing here fetches. A
 * tile that cannot be computed yet returns `null` for its value and says why, because
 * "0%" and "nothing has been sent yet" are different facts and only one of them is true.
 */
import type { Approval, Endeavour, Opportunity, Prospect, Thread } from "./types";
import type { BudgetStatus } from "./types";

export interface StatContext {
  endeavour: Endeavour;
  prospects: readonly Prospect[];
  threads: readonly Thread[];
  approvals: readonly Approval[];
  opportunities: readonly Opportunity[];
  budget: BudgetStatus;
  now: Date;
}

export interface StatValue {
  /** The number itself, already formatted. Null when there is nothing to show yet. */
  display: string | null;
  /** A second line: what the number is out of, or why there isn't one. */
  sub?: string;
  /** Drives the tile's colour. "plain" is the default; nothing is good or bad by default. */
  tone?: "plain" | "good" | "warn";
}

export interface StatTile {
  id: string;
  /** Shown on the tile, in caps. Keep it to three words. */
  label: string;
  /** Shown in settings, so the operator knows what they are choosing. */
  hint: string;
  group: "outcome" | "activity" | "efficiency" | "clock";
  compute: (ctx: StatContext) => StatValue;
}

/* ---------- formatting ---------- */

const MONEY: Record<string, string> = { GBP: "£", USD: "$", EUR: "€" };

/** Big numbers are read at a glance, so they are shortened rather than punctuated. */
export function compact(n: number): string {
  const abs = Math.abs(n);
  // A trailing ".0" is noise on a headline number: 3000 is "3k", not "3.0k".
  const trim = (value: string) => value.replace(/\.0$/, "");
  if (abs >= 1_000_000) return `${trim((n / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1))}M`;
  if (abs >= 10_000) return `${Math.round(n / 1000)}k`;
  if (abs >= 1000) return `${trim((n / 1000).toFixed(1))}k`;
  return String(Math.round(n));
}

export function money(amount: number, unit: string): string {
  const symbol = MONEY[unit] ?? "";
  return `${symbol}${compact(amount)}`;
}

const pence = (p: number) => `£${(p / 100).toFixed(p >= 10_000 ? 0 : 2)}`;
const percent = (part: number, whole: number) => `${Math.round((part / whole) * 100)}%`;

/* ---------- the facts every tile draws on ---------- */

const messages = (ctx: StatContext) => ctx.threads.flatMap((t) => t.messages);
const sentCount = (ctx: StatContext) => messages(ctx).filter((m) => m.sendState === "sent").length;
const replyCount = (ctx: StatContext) => messages(ctx).filter((m) => m.author === "PROSPECT").length;
const awaitingCount = (ctx: StatContext) => ctx.approvals.length;
const wonValue = (ctx: StatContext) =>
  ctx.opportunities.filter((o) => o.stage === "won").reduce((sum, o) => sum + o.value, 0);

const daysLeft = (ctx: StatContext) => {
  const end = new Date(`${ctx.endeavour.deadline}T23:59:59Z`).getTime();
  return Math.max(0, Math.ceil((end - ctx.now.getTime()) / 86_400_000));
};

/* ---------- the catalogue ---------- */

export const STAT_TILES: StatTile[] = [
  /* --- outcome --- */
  {
    id: "revenue",
    label: "Revenue won",
    hint: "Value of opportunities that have reached won.",
    group: "outcome",
    compute: (ctx) => {
      const won = wonValue(ctx);
      const unit = ctx.endeavour.unit === "GBP" ? "GBP" : "";
      return {
        display: money(won, unit),
        sub: `of ${money(ctx.endeavour.targetValue, unit)} target`,
        tone: won >= ctx.endeavour.targetValue ? "good" : "plain",
      };
    },
  },
  {
    id: "objective",
    label: "Objective progress",
    hint: "How far the endeavour is towards its target, whatever it is counted in.",
    group: "outcome",
    compute: (ctx) => {
      const { actualValue, targetValue } = ctx.endeavour;
      if (targetValue <= 0) return { display: null, sub: "no target set" };
      return {
        display: percent(actualValue, targetValue),
        sub: `${compact(actualValue)} of ${compact(targetValue)}`,
        tone: actualValue >= targetValue ? "good" : "plain",
      };
    },
  },
  {
    id: "pipeline",
    label: "Open pipeline",
    hint: "Value of opportunities still in play, not yet won or lost.",
    group: "outcome",
    compute: (ctx) => {
      const unit = ctx.endeavour.unit === "GBP" ? "GBP" : "";
      const open = ctx.opportunities.filter((o) => o.stage !== "won");
      return { display: money(open.reduce((s, o) => s + o.value, 0), unit), sub: `${open.length} open` };
    },
  },
  {
    id: "leads",
    label: "Leads secured",
    hint: "Prospects that passed qualification.",
    group: "outcome",
    compute: (ctx) => ({
      display: compact(ctx.prospects.filter((p) => p.status === "QUALIFIED").length),
      sub: `of ${ctx.prospects.length} researched`,
    }),
  },
  {
    id: "meetings",
    label: "Meetings booked",
    hint: "Prospects that reached a meeting or beyond.",
    group: "outcome",
    compute: (ctx) => {
      const f = ctx.endeavour.funnel;
      return { display: compact((f.meeting ?? 0) + (f.proposal ?? 0) + (f.won ?? 0)), sub: "meeting or beyond" };
    },
  },

  /* --- activity --- */
  {
    id: "sent",
    label: "Pings out",
    hint: "Messages actually sent, not drafted.",
    group: "activity",
    compute: (ctx) => ({ display: compact(sentCount(ctx)), sub: `${ctx.threads.length} threads` }),
  },
  {
    id: "replies",
    label: "Replies in",
    hint: "Messages received from prospects.",
    group: "activity",
    compute: (ctx) => ({ display: compact(replyCount(ctx)), sub: `${ctx.threads.filter((t) => t.unread).length} unread` }),
  },
  {
    id: "awaiting",
    label: "Awaiting review",
    hint: "Decisions waiting on you — nothing moves until they are cleared.",
    group: "activity",
    compute: (ctx) => {
      const n = awaitingCount(ctx);
      return { display: compact(n), sub: n === 0 ? "nothing waiting" : "your move", tone: n > 0 ? "warn" : "good" };
    },
  },
  {
    id: "quota",
    label: "Today's quota",
    hint: "How much of today's planned outreach and follow-up is done.",
    group: "activity",
    compute: (ctx) => {
      const { quota, quotaDone } = ctx.endeavour;
      const planned = quota.newProspects + quota.outreach + quota.followups;
      if (planned <= 0) return { display: null, sub: "nothing planned today" };
      const done = quotaDone.newProspects + quotaDone.outreach + quotaDone.followups;
      return { display: percent(done, planned), sub: `${done} of ${planned}`, tone: done >= planned ? "good" : "plain" };
    },
  },
  {
    id: "quiet",
    label: "Gone quiet",
    hint: "Prospects contacted who have not replied — the follow-up backlog.",
    group: "activity",
    compute: (ctx) => {
      const replied = new Set(ctx.threads.filter((t) => t.messages.some((m) => m.author === "PROSPECT")).map((t) => t.prospectId));
      const n = ctx.threads.filter((t) => !replied.has(t.prospectId)).length;
      return { display: compact(n), sub: "no reply yet" };
    },
  },

  /* --- efficiency --- */
  {
    id: "reply_rate",
    label: "Reply rate",
    hint: "Share of sent messages that got a reply. The number that says whether the copy works.",
    group: "efficiency",
    compute: (ctx) => {
      const sent = sentCount(ctx);
      // A rate off two sends is noise dressed as a measurement.
      if (sent < 5) return { display: null, sub: `${sent} sent — too few to rate` };
      return { display: percent(replyCount(ctx), sent), sub: `${replyCount(ctx)} of ${sent} sent` };
    },
  },
  {
    id: "spend_month",
    label: "Credit burned",
    hint: "What the agent has cost this month, against your cap.",
    group: "efficiency",
    compute: (ctx) => {
      const { spentMonthPence, monthlyBudgetPence } = ctx.budget;
      if (monthlyBudgetPence <= 0) return { display: pence(spentMonthPence), sub: "no cap set" };
      return {
        display: pence(spentMonthPence),
        sub: `of ${pence(monthlyBudgetPence)} cap`,
        tone: spentMonthPence >= monthlyBudgetPence ? "warn" : "plain",
      };
    },
  },
  {
    id: "cost_per_reply",
    label: "Cost per reply",
    hint: "Credit burned this month divided by replies. What a conversation actually costs.",
    group: "efficiency",
    compute: (ctx) => {
      const replies = replyCount(ctx);
      if (replies === 0) return { display: null, sub: "no replies yet" };
      return { display: pence(ctx.budget.spentMonthPence / replies), sub: `over ${replies} replies` };
    },
  },
  {
    id: "runway",
    label: "Credit runway",
    hint: "Days of budget left at today's burn rate.",
    group: "efficiency",
    compute: (ctx) => {
      const { spentTodayPence, monthlyBudgetPence, spentMonthPence } = ctx.budget;
      if (spentTodayPence <= 0) return { display: null, sub: "nothing spent today" };
      const left = monthlyBudgetPence - spentMonthPence;
      const days = Math.floor(left / spentTodayPence);
      return { display: `${Math.max(0, days)}d`, sub: `at ${pence(spentTodayPence)}/day`, tone: days <= 3 ? "warn" : "plain" };
    },
  },

  /* --- clock --- */
  {
    id: "days_left",
    label: "On the clock",
    hint: "Days to the deadline, or to the end of the current review period.",
    group: "clock",
    compute: (ctx) => {
      const days = daysLeft(ctx);
      return {
        display: `${days}d`,
        sub: ctx.endeavour.period ? `to end of ${ctx.endeavour.period}` : `to ${ctx.endeavour.deadline}`,
        tone: days <= 7 ? "warn" : "plain",
      };
    },
  },
  {
    id: "needed_per_day",
    label: "Needed per day",
    hint: "What has to land each remaining day to hit the target. Zero means you are there.",
    group: "clock",
    compute: (ctx) => {
      const { actualValue, targetValue, unit } = ctx.endeavour;
      const gap = targetValue - actualValue;
      if (gap <= 0) return { display: "0", sub: "target met", tone: "good" };
      const days = daysLeft(ctx);
      if (days === 0) return { display: null, sub: "no days left" };
      return {
        display: unit === "GBP" ? money(gap / days, "GBP") : compact(Math.ceil(gap / days)),
        sub: `over ${days} days`,
      };
    },
  },
];

export const STAT_TILE_IDS = STAT_TILES.map((t) => t.id);

/** What a new install shows: what went out, what came back, what is stuck, what it won. */
export const DEFAULT_STAT_TILES = ["sent", "replies", "awaiting", "meetings"] as const;

export const STAT_TILE_COUNT = 4;

export const findStatTile = (id: string) => STAT_TILES.find((t) => t.id === id);

/**
 * The tiles to render, given what was saved.
 *
 * Saved ids that no longer exist are dropped rather than rendered as a gap, and the
 * defaults backfill so the row is always full — a half-empty row of headline numbers looks
 * like a fault, and this is a display preference, not data worth an error.
 */
export function resolveStatTiles(saved: readonly string[] | null | undefined): StatTile[] {
  const wanted = [...(saved ?? [])].filter((id, i, all) => findStatTile(id) && all.indexOf(id) === i);
  for (const id of DEFAULT_STAT_TILES) {
    if (wanted.length >= STAT_TILE_COUNT) break;
    if (!wanted.includes(id)) wanted.push(id);
  }
  return wanted.slice(0, STAT_TILE_COUNT).map((id) => findStatTile(id)!);
}
