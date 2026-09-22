/**
 * Claude via the official SDK. Server-side refusal fallbacks are on by default,
 * paused server-tool turns are resumed, and usage is reported for cost accounting.
 */
import Anthropic from "@anthropic-ai/sdk";
import { capabilitiesOf, thinkingBudget } from "./capabilities";
import type { LlmClient, LlmRequest, LlmResponse, WebSource } from "./types";
import { LlmRefusalError } from "./types";

const MAX_RESUMES = 5;

export class AnthropicLlm implements LlmClient {
  constructor(private readonly client: Anthropic = new Anthropic()) {}

  async complete(req: LlmRequest): Promise<LlmResponse> {
    const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: req.user }];
    const usage = { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0, webSearchRequests: 0 };
    const sources: WebSource[] = [];

    // What the model accepts differs by model; sending the wrong shape is a 400, not a downgrade.
    const caps = capabilitiesOf(req.model);
    const budget = caps.thinking === "budget" ? thinkingBudget(req.maxTokens) : null;
    const thinking =
      caps.thinking === "adaptive"
        ? ({ type: "adaptive" } as const)
        : budget !== null
          ? ({ type: "enabled", budget_tokens: budget } as const)
          : undefined;

    for (let attempt = 0; attempt <= MAX_RESUMES; attempt++) {
      const message = await this.client.beta.messages
        .stream({
          model: req.model,
          max_tokens: req.maxTokens,
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
          ...(thinking ? { thinking } : {}),
          system: [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }],
          messages,
          output_config: {
            format: { type: "json_schema", schema: req.jsonSchema },
            ...(req.effort && caps.effort ? { effort: req.effort } : {}),
          },
          ...(req.webSearch
            ? { tools: [{ type: caps.webSearchTool, name: "web_search" as const, max_uses: req.webSearch.maxUses }] }
            : {}),
        })
        .finalMessage();

      usage.inputTokens += message.usage.input_tokens;
      usage.outputTokens += message.usage.output_tokens;
      usage.cacheCreationInputTokens += message.usage.cache_creation_input_tokens ?? 0;
      usage.cacheReadInputTokens += message.usage.cache_read_input_tokens ?? 0;
      usage.webSearchRequests += message.usage.server_tool_use?.web_search_requests ?? 0;

      for (const block of message.content) {
        if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
          for (const r of block.content) sources.push({ url: r.url, title: r.title });
        }
      }

      if (message.stop_reason === "refusal") {
        throw new LlmRefusalError(message.stop_details?.category ?? null);
      }
      if (message.stop_reason === "pause_turn") {
        messages.push({ role: "assistant", content: message.content });
        continue;
      }
      const text = message.content
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
        .map((b) => b.text)
        .join("");
      return { text, model: message.model, usage, sources };
    }
    throw new Error("the model kept pausing and never finished");
  }
}
