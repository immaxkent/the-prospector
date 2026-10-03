import { describe, expect, it, vi } from "vitest";
import { budgetState, type BudgetSettings } from "../domain/budget";
import { BudgetExceededError, budgetedLlm } from "./budgeted";
import type { LlmClient, LlmResponse } from "./types";

const AT = new Date("2026-09-18T09:00:00Z");
const settings: BudgetSettings = { model: "claude-haiku-4-5", monthlyBudgetPence: 1500 };
const answer: LlmResponse = {
  text: "{}",
  model: "claude-haiku-4-5",
  usage: { inputTokens: 1, outputTokens: 1, cacheCreationInputTokens: 0, cacheReadInputTokens: 0, webSearchRequests: 0 },
  sources: [],
};
const request = { model: "claude-haiku-4-5", system: "s", user: "u", jsonSchema: {}, maxTokens: 100 };

const state = (todayUsd: number, monthUsd = todayUsd) =>
  budgetState(settings, { todayUsd, monthUsd, allTimeUsd: monthUsd }, 1.25, AT);

describe("budgetedLlm", () => {
  it("calls the model while there is budget left", async () => {
    const inner: LlmClient = { complete: vi.fn(async () => answer) };
    const client = budgetedLlm(inner, async () => state(0.1));
    await expect(client.complete(request)).resolves.toBe(answer);
    expect(inner.complete).toHaveBeenCalledOnce();
  });

  it("refuses before spending anything when the day's share is gone", async () => {
    const inner: LlmClient = { complete: vi.fn(async () => answer) };
    const client = budgetedLlm(inner, async () => state(1));
    await expect(client.complete(request)).rejects.toBeInstanceOf(BudgetExceededError);
    expect(inner.complete).not.toHaveBeenCalled();
  });

  it("says which budget ran out", async () => {
    const daily = budgetedLlm({ complete: async () => answer }, async () => state(1, 2));
    await expect(daily.complete(request)).rejects.toThrow("pick up tomorrow");
    const monthly = budgetedLlm({ complete: async () => answer }, async () => state(0, 20));
    await expect(monthly.complete(request)).rejects.toThrow("raise it in Settings");
  });

  it("re-reads the spend for every call, so a run stops partway once it runs out", async () => {
    let spent = 0;
    const inner: LlmClient = {
      complete: vi.fn(async () => {
        spent += 0.35; // 28p a call against a 50p day: the third call has nothing left
        return answer;
      }),
    };
    const client = budgetedLlm(inner, async () => state(spent));
    await client.complete(request);
    await client.complete(request);
    await expect(client.complete(request)).rejects.toBeInstanceOf(BudgetExceededError);
    expect(inner.complete).toHaveBeenCalledTimes(2);
  });
});

describe("phase budgets", () => {
  const state = {
    spentTodayPence: 20,
    spentMonthPence: 20,
    spentAllTimePence: 20,
    dailyAllowancePence: 100,
    monthlyBudgetPence: 1500,
    remainingTodayPence: 80,
    allowed: true,
    reason: "ok" as const,
  };

  const ask = (role: string | undefined) => ({
    role,
    model: "claude-opus-5",
    system: "s",
    user: "u",
    jsonSchema: {},
    maxTokens: 100,
  });

  it("stops a phase at its own share even though the day has money left", async () => {
    // The whole fix. Research exhausting itself must not end qualification's day.
    const calls: string[] = [];
    const inner = { complete: async () => { calls.push("called"); return {} as never; } };
    const llm = budgetedLlm(inner, async () => state, async () => ({ reply: 10, research: 45 }));

    await expect(llm.complete(ask("research.discover"))).rejects.toBeInstanceOf(BudgetExceededError);
    expect(calls).toEqual([]);
    await llm.complete(ask("research.qualify"));
    expect(calls).toEqual(["called"]);
  });

  it("names the phase, not the day", async () => {
    // "The budget is spent" sent the operator to their billing page while the day still had
    // plenty left for everything else.
    // reply spent its own share, so research inherits no surplus and stops at 45.
    const llm = budgetedLlm(
      { complete: async () => ({}) as never },
      async () => state,
      async () => ({ reply: 10, research: 45 }),
    );
    await expect(llm.complete(ask("research.discover"))).rejects.toThrow(/research has spent its share of today/);
  });

  it("lets work that is not part of a run answer to the day alone", async () => {
    // A person is waiting on intake; it does not belong to a phase and must not be refused
    // because research was greedy this morning.
    const llm = budgetedLlm({ complete: async () => ({}) as never }, async () => state, async () => ({ research: 999 }));
    await expect(llm.complete(ask("intake.planner"))).resolves.toBeDefined();
    await expect(llm.complete(ask(undefined))).resolves.toBeDefined();
  });

  it("still refuses everything once the day itself is gone", async () => {
    const spent = { ...state, allowed: false, reason: "daily_budget_spent" as const };
    const llm = budgetedLlm({ complete: async () => ({}) as never }, async () => spent, async () => ({}));
    await expect(llm.complete(ask("research.qualify"))).rejects.toThrow(/share of the model budget is spent/);
  });

  it("behaves exactly as before when nothing can read the per-phase spend", async () => {
    const llm = budgetedLlm({ complete: async () => ({}) as never }, async () => state);
    await expect(llm.complete(ask("research.discover"))).resolves.toBeDefined();
  });
});
