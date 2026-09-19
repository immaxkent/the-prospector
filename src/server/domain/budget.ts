/**
 * What the system is allowed to spend on the model.
 *
 * The budget is set in pounds because that is what the bill is in; the prices are in dollars,
 * so a rate converts between them. The rate is an assumption, not a market feed, and it is
 * shown wherever a figure derived from it is shown.
 *
 * A month's budget is spread evenly across its days. Spending it all in week one would leave
 * three weeks of silence, which is worse for an endeavour than a steady trickle.
 */

/** Models the operator may choose, cheapest first, with what each is good for. */
export const SELECTABLE_MODELS = [
  { id: "claude-haiku-4-5", label: "Haiku 4.5", note: "Cheapest. Fine for classifying replies and scoring." },
  { id: "claude-sonnet-5", label: "Sonnet 5", note: "Better judgement and better copy, about three times the cost." },
  { id: "claude-opus-5", label: "Opus 5", note: "Strongest, and far more expensive. Only worth it if the drafts are weak." },
] as const;

export type SelectableModel = (typeof SELECTABLE_MODELS)[number]["id"];

export const isSelectableModel = (id: string): id is SelectableModel =>
  SELECTABLE_MODELS.some((m) => m.id === id);

export interface BudgetSettings {
  model: string;
  /** Ceiling for a calendar month, in pence. Zero means the model is not to be used at all. */
  monthlyBudgetPence: number;
}

export const DEFAULT_BUDGET: BudgetSettings = { model: "claude-haiku-4-5", monthlyBudgetPence: 1500 };

export const daysInMonth = (at: Date) =>
  new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 0)).getUTCDate();

/** A month's budget spread evenly over its days, rounded down so the month cannot overrun. */
export function dailyAllowancePence(monthlyBudgetPence: number, at: Date) {
  return Math.floor(Math.max(0, monthlyBudgetPence) / daysInMonth(at));
}

export const usdToPence = (usd: number, usdPerGbp: number) => Math.round((usd / usdPerGbp) * 100);

export interface Spend {
  /** Recorded cost so far today and this calendar month, in US dollars. */
  todayUsd: number;
  monthUsd: number;
}

export interface BudgetState {
  spentTodayPence: number;
  spentMonthPence: number;
  dailyAllowancePence: number;
  monthlyBudgetPence: number;
  /** What is left today: the smaller of the day's remainder and the month's. Never negative. */
  remainingTodayPence: number;
  /** False when a call must not be made. */
  allowed: boolean;
  reason: "ok" | "daily_budget_spent" | "monthly_budget_spent" | "no_budget";
}

export function budgetState(settings: BudgetSettings, spend: Spend, usdPerGbp: number, at: Date): BudgetState {
  const spentTodayPence = usdToPence(spend.todayUsd, usdPerGbp);
  const spentMonthPence = usdToPence(spend.monthUsd, usdPerGbp);
  const daily = dailyAllowancePence(settings.monthlyBudgetPence, at);
  const leftToday = Math.max(0, daily - spentTodayPence);
  const leftThisMonth = Math.max(0, settings.monthlyBudgetPence - spentMonthPence);
  const remainingTodayPence = Math.min(leftToday, leftThisMonth);

  const reason: BudgetState["reason"] =
    settings.monthlyBudgetPence <= 0
      ? "no_budget"
      : leftThisMonth === 0
        ? "monthly_budget_spent"
        : leftToday === 0
          ? "daily_budget_spent"
          : "ok";

  return {
    spentTodayPence,
    spentMonthPence,
    dailyAllowancePence: daily,
    monthlyBudgetPence: settings.monthlyBudgetPence,
    remainingTodayPence,
    allowed: reason === "ok",
    reason,
  };
}

/** What to tell the operator when the loop stops early. */
export const BUDGET_MESSAGES: Record<Exclude<BudgetState["reason"], "ok">, string> = {
  no_budget: "no model budget is set, so nothing that needs Claude can run",
  daily_budget_spent: "today's share of the model budget is spent; the loop will pick up tomorrow",
  monthly_budget_spent: "this month's model budget is spent; raise it in Settings or wait for the new month",
};
