/**
 * A model client that refuses to spend more than it was allowed.
 *
 * The check happens before the call, because a budget enforced after the bill arrives is not
 * a budget. Spend is re-read each time: a long run that exhausts the day's share stops partway
 * rather than finishing at any price.
 */
import type { BudgetState } from "../domain/budget";
import { BUDGET_MESSAGES } from "../domain/budget";
import type { LlmClient, LlmRequest, LlmResponse } from "./types";

export class BudgetExceededError extends Error {
  constructor(readonly state: BudgetState) {
    super(BUDGET_MESSAGES[state.reason as Exclude<BudgetState["reason"], "ok">] ?? "the model budget is spent");
    this.name = "BudgetExceededError";
  }
}

export function budgetedLlm(inner: LlmClient, readState: () => Promise<BudgetState>): LlmClient {
  return {
    async complete(request: LlmRequest): Promise<LlmResponse> {
      const state = await readState();
      if (!state.allowed) throw new BudgetExceededError(state);
      return inner.complete(request);
    },
  };
}
