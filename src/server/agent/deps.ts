/** Builds the agent's model client: the real Claude, the fixture, or none when unconfigured. */
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
  const [{ AnthropicLlm }, Anthropic] = await Promise.all([import("../llm/anthropic"), import("@anthropic-ai/sdk")]);
  return { llm: new AnthropicLlm(new Anthropic.default({ apiKey: config.anthropicApiKey })), model: config.model, record };
}
