/**
 * Builds the agent's model client: the real Claude, the fixture, or none when unconfigured.
 * The stored settings choose the model and cap the spend; the guard refuses a call that would
 * go over, so the ceiling holds even mid-run.
 */
import type { AppConfig } from "../config";
import type { Database } from "../db/client";
import { dbRecorder } from "../llm/recorder";
import type { CallRecorder } from "../llm/structured";
import type { BatchLlmClient } from "../llm/batch";
import type { LlmClient } from "../llm/types";
import { FixtureAgentLlm } from "./fixture";

export interface AgentDeps {
  llm: LlmClient;
  model: string;
  record: CallRecorder;
  /** Present when work can be batched at half the token price. Absent in fixtures. */
  batch?: BatchLlmClient;
}

export async function createAgentDeps(config: AppConfig, db: Database): Promise<AgentDeps | null> {
  const record = dbRecorder(db);
  if (config.plannerFixture) return { llm: new FixtureAgentLlm(), model: config.model, record };
  if (!config.anthropicApiKey) return null;

  const [{ AnthropicLlm }, Anthropic, { budgetedLlm }, { loadBudgetState, loadSettings }] = await Promise.all([
    import("../llm/anthropic"),
    import("@anthropic-ai/sdk"),
    import("../llm/budgeted"),
    import("../commands/settings"),
  ]);
  const { AnthropicBatchLlm } = await import("../llm/batch");
  const settings = await loadSettings(db);

  const client = new Anthropic.default({
    apiKey: config.anthropicApiKey,
    // An organisation-level key is refused without this; a workspace-scoped key ignores it.
    ...(config.anthropicWorkspaceId ? { defaultHeaders: { "anthropic-workspace-id": config.anthropicWorkspaceId } } : {}),
  });
  const llm = budgetedLlm(new AnthropicLlm(client), () => loadBudgetState(db, config.usdPerGbp));

  // The same credentials, used two ways: one call at a time, or a day's work at once.
  return { llm, model: settings.model, record, batch: new AnthropicBatchLlm(client) };
}
