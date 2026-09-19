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
  budgetState(settings, { todayUsd, monthUsd }, 1.25, AT);

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
