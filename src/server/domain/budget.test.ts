import { describe, expect, it } from "vitest";
import {
  BUDGET_MESSAGES,
  DEFAULT_BUDGET,
  budgetState,
  dailyAllowancePence,
  daysInMonth,
  isSelectableModel,
  usdToPence,
  type BudgetSettings,
} from "./budget";

const RATE = 1.25; // $1.25 to the pound, so £1 of spend is $1.25.
const SEPT = new Date("2026-09-18T09:00:00Z"); // 30 days
const FEB = new Date("2026-02-10T09:00:00Z"); // 28 days
const settings: BudgetSettings = { model: "claude-haiku-4-5", monthlyBudgetPence: 1500 };

describe("daily allowance", () => {
  it("spreads the month evenly over its days, rounding down", () => {
    expect(daysInMonth(SEPT)).toBe(30);
    expect(dailyAllowancePence(1500, SEPT)).toBe(50);
    expect(daysInMonth(FEB)).toBe(28);
    expect(dailyAllowancePence(1500, FEB)).toBe(53);
  });

  it("is zero when there is no budget", () => {
    expect(dailyAllowancePence(0, SEPT)).toBe(0);
    expect(dailyAllowancePence(-100, SEPT)).toBe(0);
  });
});

describe("converting dollars to pence", () => {
  it("uses the given rate", () => {
    expect(usdToPence(1.25, RATE)).toBe(100);
    expect(usdToPence(0, RATE)).toBe(0);
  });
});

describe("budgetState", () => {
  const state = (spend: { todayUsd: number; monthUsd: number }, over: Partial<BudgetSettings> = {}) =>
    budgetState({ ...settings, ...over }, spend, RATE, SEPT);

  it("allows a call while the day's share is unspent", () => {
    expect(state({ todayUsd: 0.25, monthUsd: 2.5 })).toMatchObject({
      spentTodayPence: 20,
      spentMonthPence: 200,
      dailyAllowancePence: 50,
      remainingTodayPence: 30,
      allowed: true,
      reason: "ok",
    });
  });

  it("stops for the day once the day's share is spent, without touching the rest of the month", () => {
    const result = state({ todayUsd: 0.63, monthUsd: 2 });
    expect(result).toMatchObject({ allowed: false, reason: "daily_budget_spent", remainingTodayPence: 0 });
    expect(BUDGET_MESSAGES[result.reason as "daily_budget_spent"]).toContain("tomorrow");
  });

  it("stops for the month when the whole budget is gone, even on a fresh day", () => {
    const result = state({ todayUsd: 0, monthUsd: 20 });
    expect(result).toMatchObject({ allowed: false, reason: "monthly_budget_spent", remainingTodayPence: 0 });
  });

  it("never reports a negative remainder after an overrun", () => {
    expect(state({ todayUsd: 5, monthUsd: 40 }).remainingTodayPence).toBe(0);
  });

  it("says plainly when no budget is set at all", () => {
    expect(state({ todayUsd: 0, monthUsd: 0 }, { monthlyBudgetPence: 0 })).toMatchObject({
      allowed: false,
      reason: "no_budget",
    });
  });

  it("caps the day by whatever is left of the month near the end of it", () => {
    // £14.60 of the £15 spent leaves 40p for the month, but the day's share is 50p:
    // the day may only use the 40p that is actually left.
    expect(state({ todayUsd: 0, monthUsd: 18.25 }).remainingTodayPence).toBe(40);
  });
});

describe("selectable models", () => {
  it("defaults to the cheapest and accepts only models we have prices for", () => {
    expect(DEFAULT_BUDGET.model).toBe("claude-haiku-4-5");
    expect(isSelectableModel("claude-haiku-4-5")).toBe(true);
    expect(isSelectableModel("gpt-4")).toBe(false);
  });
});
