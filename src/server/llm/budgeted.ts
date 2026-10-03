/**
 * A model client that refuses to spend more than it was allowed.
 *
 * The check happens before the call, because a budget enforced after the bill arrives is not
 * a budget. Spend is re-read each time: a long run that exhausts the day's share stops partway
 * rather than finishing at any price.
 */
import type { BudgetState } from "../domain/budget";
import { BUDGET_MESSAGES } from "../domain/budget";
import { phaseExhausted, phaseOf, phaseVerdict, type RunPhase } from "../domain/phase-budget";
import type { LlmClient, LlmRequest, LlmResponse } from "./types";

export class BudgetExceededError extends Error {
  constructor(
    readonly state: BudgetState,
    /** Set when one phase ran out rather than the whole day. */
    readonly phase: RunPhase | null = null,
    message?: string,
  ) {
    super(message ?? BUDGET_MESSAGES[state.reason as Exclude<BudgetState["reason"], "ok">] ?? "the model budget is spent");
    this.name = "BudgetExceededError";
  }
}

/** Today's spend in pence, by phase. Absent when nothing can read it. */
export type PhaseSpendReader = () => Promise<Partial<Record<RunPhase, number>>>;

export function budgetedLlm(
  inner: LlmClient,
  readState: () => Promise<BudgetState>,
  readPhaseSpend?: PhaseSpendReader,
): LlmClient {
  return {
    async complete(request: LlmRequest): Promise<LlmResponse> {
      const state = await readState();
      if (!state.allowed) throw new BudgetExceededError(state);

      /*
       * Then the phase, if this call belongs to one.
       *
       * The day being fine is not enough. Research can exhaust a day on its own and leave
       * qualification nothing — which is exactly what happened on 1 October, when eighteen
       * prospects were found and not one was scored.
       *
       * The refusal names the phase, because "the budget is spent" sent the operator
       * looking at their billing when the day had plenty left in it for everything else.
       */
      const phase = request.role ? phaseOf(request.role) : null;
      if (phase && readPhaseSpend) {
        const verdict = phaseVerdict(phase, state.dailyAllowancePence, await readPhaseSpend());
        if (!verdict.allowed) throw new BudgetExceededError(state, phase, phaseExhausted(phase, verdict));
      }

      return inner.complete(request);
    },
  };
}
