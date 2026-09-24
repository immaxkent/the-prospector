/**
 * Running many model calls as one batch, at half the token price.
 *
 * The daily loop qualifies and drafts for a whole day's prospects at once, and none of that
 * work needs an answer in seconds. Batches are the same requests at half the token cost, in
 * exchange for waiting — usually a couple of minutes.
 *
 * The wait is bounded. A background job that blocks indefinitely is worse than a dearer one,
 * so a batch that has not finished in time raises, and the caller falls back to ordinary
 * calls rather than letting the day stall.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { DEPTH_EFFORT, capabilitiesOf, thinkingBudget } from "./capabilities";
import type { LlmRequest, LlmResponse, WebSource } from "./types";

/** How long a batch may take before the caller gives up and pays full price instead. */
export const DEFAULT_BATCH_WAIT_MS = 5 * 60_000;

/** How often to ask whether it has finished. */
export const BATCH_POLL_MS = 10_000;

export class BatchTimeoutError extends Error {
  constructor(readonly batchId: string, waitedMs: number) {
    super(`batch ${batchId} did not finish within ${Math.round(waitedMs / 1000)}s`);
    this.name = "BatchTimeoutError";
  }
}

export interface BatchItem {
  /** Caller's own key, returned with the result so answers can be matched to questions. */
  id: string;
  request: LlmRequest;
}

export interface BatchOutcome {
  id: string;
  /** Present when the request succeeded. */
  response?: LlmResponse;
  /** Present when that one request failed, which does not fail the others. */
  error?: string;
}

export interface BatchLlmClient {
  completeMany(items: readonly BatchItem[], opts?: { waitMs?: number }): Promise<BatchOutcome[]>;
}

/** The request body for one item, shaped the way the model in question accepts. */
export function batchParams(req: LlmRequest) {
  const caps = capabilitiesOf(req.model);
  const budget = caps.thinking === "budget" ? thinkingBudget(req.maxTokens, req.depth ?? "deep") : null;
  const thinking =
    caps.thinking === "adaptive"
      ? ({ type: "adaptive" } as const)
      : budget !== null
        ? ({ type: "enabled", budget_tokens: budget } as const)
        : undefined;

  return {
    model: req.model,
    max_tokens: req.maxTokens,
    // Server-side fallbacks are rejected on batches, so they are not sent here.
    ...(thinking ? { thinking } : {}),
    system: [{ type: "text" as const, text: req.system, cache_control: { type: "ephemeral" as const } }],
    messages: [{ role: "user" as const, content: req.user }],
    output_config: {
      format: { type: "json_schema" as const, schema: req.jsonSchema },
      ...(caps.effort ? { effort: req.effort ?? DEPTH_EFFORT[req.depth ?? "deep"] } : {}),
    },
    ...(req.webSearch
      ? { tools: [{ type: caps.webSearchTool, name: "web_search" as const, max_uses: req.webSearch.maxUses }] }
      : {}),
  };
}

/** Reads one finished batch entry into the shape the rest of the system speaks. */
export function readBatchEntry(entry: {
  custom_id: string;
  result: { type: string; message?: unknown; error?: unknown };
}): BatchOutcome {
  if (entry.result.type !== "succeeded" || !entry.result.message) {
    const detail = entry.result.error ? JSON.stringify(entry.result.error).slice(0, 300) : entry.result.type;
    return { id: entry.custom_id, error: `the request ${entry.result.type}: ${detail}` };
  }
  const message = entry.result.message as {
    model: string;
    content: { type: string; text?: string; content?: { url: string; title: string }[] }[];
    usage: Record<string, number | undefined> & { server_tool_use?: { web_search_requests?: number } };
  };

  const sources: WebSource[] = [];
  for (const block of message.content) {
    if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
      for (const r of block.content) sources.push({ url: r.url, title: r.title });
    }
  }
  const text = message.content
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("");

  return {
    id: entry.custom_id,
    response: {
      text,
      model: message.model,
      usage: {
        inputTokens: message.usage["input_tokens"] ?? 0,
        outputTokens: message.usage["output_tokens"] ?? 0,
        cacheCreationInputTokens: message.usage["cache_creation_input_tokens"] ?? 0,
        cacheReadInputTokens: message.usage["cache_read_input_tokens"] ?? 0,
        webSearchRequests: message.usage.server_tool_use?.web_search_requests ?? 0,
      },
      sources,
    },
  };
}

export class AnthropicBatchLlm implements BatchLlmClient {
  constructor(
    private readonly client: Anthropic,
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
    private readonly now: () => number = Date.now,
  ) {}

  async completeMany(items: readonly BatchItem[], opts: { waitMs?: number } = {}): Promise<BatchOutcome[]> {
    if (items.length === 0) return [];
    const waitMs = opts.waitMs ?? DEFAULT_BATCH_WAIT_MS;

    const batch = await this.client.messages.batches.create({
      requests: items.map((item) => ({ custom_id: item.id, params: batchParams(item.request) as never })),
    });

    const deadline = this.now() + waitMs;
    for (;;) {
      const current = await this.client.messages.batches.retrieve(batch.id);
      if (current.processing_status === "ended") break;
      if (this.now() >= deadline) throw new BatchTimeoutError(batch.id, waitMs);
      await this.sleep(BATCH_POLL_MS);
    }

    const outcomes: BatchOutcome[] = [];
    for await (const entry of await this.client.messages.batches.results(batch.id)) {
      outcomes.push(readBatchEntry(entry as never));
    }
    // Results arrive in whatever order they finished; the caller matches on its own ids.
    return outcomes;
  }
}
