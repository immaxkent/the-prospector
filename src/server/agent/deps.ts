/**
 * Builds the agent's model client: the real Claude, the fixture, or none when unconfigured.
 * The stored settings choose the model and cap the spend; the guard refuses a call that would
 * go over, so the ceiling holds even mid-run.
 */
import type { AppConfig } from "../config";
import type { Database } from "../db/client";
import { dbRecorder } from "../llm/recorder";
import type { CallRecorder } from "../llm/structured";
import type { LlmClient } from "../llm/types";
import { FixtureAgentLlm } from "./fixture";

export interface AgentDeps {
  llm: LlmClient;
  model: string;
  record: CallRecorder;
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
  const settings = await loadSettings(db);
  const llm = budgetedLlm(
    new AnthropicLlm(
      new Anthropic.default({
        apiKey: config.anthropicApiKey,
        // An organisation-level key is refused without this; a workspace-scoped key ignores it.
        ...(config.anthropicWorkspaceId
          ? { defaultHeaders: { "anthropic-workspace-id": config.anthropicWorkspaceId } }
          : {}),
      }),
    ),
    () => loadBudgetState(db, config.usdPerGbp),
  );
  return { llm, model: settings.model, record };
}
