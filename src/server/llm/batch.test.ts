import { describe, expect, it, vi } from "vitest";
import { AnthropicBatchLlm, BatchTimeoutError, batchParams, readBatchEntry } from "./batch";
import type { LlmRequest } from "./types";

const request = (over: Partial<LlmRequest> = {}): LlmRequest => ({
  model: "claude-haiku-4-5",
  system: "s",
  user: "u",
  jsonSchema: { type: "object" },
  maxTokens: 16_000,
  ...over,
});

describe("batchParams", () => {
  it("shapes the request the way the model accepts, like an ordinary call", () => {
    const params = batchParams(request({ depth: "light" })) as Record<string, unknown>;
    expect(params["thinking"]).toEqual({ type: "enabled", budget_tokens: 1200 });
    expect(params["output_config"]).not.toHaveProperty("effort"); // Haiku rejects effort
  });

  it("uses effort instead of a budget on models that take it", () => {
    const params = batchParams(request({ model: "claude-sonnet-5", depth: "deep" })) as Record<string, any>;
    expect(params["thinking"]).toEqual({ type: "adaptive" });
    expect(params["output_config"].effort).toBe("high");
  });

  it("never sends server-side fallbacks, which batches reject", () => {
    expect(JSON.stringify(batchParams(request()))).not.toContain("fallback");
  });

  it("asks for the web search tool the model supports", () => {
    const haiku = batchParams(request({ webSearch: { maxUses: 3 } })) as Record<string, any>;
    expect(haiku["tools"][0].type).toBe("web_search_20250305");
    const sonnet = batchParams(request({ model: "claude-sonnet-5", webSearch: { maxUses: 3 } })) as Record<string, any>;
    expect(sonnet["tools"][0].type).toBe("web_search_20260209");
  });
});

describe("readBatchEntry", () => {
  const succeeded = {
    custom_id: "a",
    result: {
      type: "succeeded",
      message: {
        model: "claude-haiku-4-5-20251001",
        content: [
          { type: "web_search_tool_result", content: [{ url: "https://x.example", title: "X" }] },
          { type: "text", text: '{"ok":true}' },
        ],
        usage: { input_tokens: 100, output_tokens: 20, server_tool_use: { web_search_requests: 2 } },
      },
    },
  };

  it("reads text, usage and sources from a finished entry", () => {
    const outcome = readBatchEntry(succeeded as never);
    expect(outcome.response?.text).toBe('{"ok":true}');
    expect(outcome.response?.usage).toMatchObject({ inputTokens: 100, outputTokens: 20, webSearchRequests: 2 });
    expect(outcome.response?.sources).toEqual([{ url: "https://x.example", title: "X" }]);
  });

  it("reports one failed request without losing its id", () => {
    const outcome = readBatchEntry({ custom_id: "b", result: { type: "errored", error: { message: "nope" } } } as never);
    expect(outcome).toMatchObject({ id: "b" });
    expect(outcome.error).toContain("errored");
    expect(outcome.response).toBeUndefined();
  });

  it("treats an expired request as a failure rather than an empty answer", () => {
    expect(readBatchEntry({ custom_id: "c", result: { type: "expired" } } as never).error).toContain("expired");
  });
});

/** A stand-in for the SDK's batches namespace. */
function fakeClient(statuses: string[], entries: unknown[]) {
  const queue = [...statuses];
  return {
    created: [] as unknown[],
    messages: {
      batches: {
        create: vi.fn(async (body: unknown) => {
          (client.created as unknown[]).push(body);
          return { id: "batch_1", processing_status: "in_progress" };
        }),
        retrieve: vi.fn(async () => ({ id: "batch_1", processing_status: queue.shift() ?? "ended" })),
        results: vi.fn(async () => entries),
      },
    },
  };
  // eslint-disable-next-line no-unreachable
}
let client: ReturnType<typeof fakeClient>;

describe("completeMany", () => {
  const entries = [
    { custom_id: "two", result: { type: "succeeded", message: { model: "m", content: [{ type: "text", text: "2" }], usage: { input_tokens: 1, output_tokens: 1 } } } },
    { custom_id: "one", result: { type: "succeeded", message: { model: "m", content: [{ type: "text", text: "1" }], usage: { input_tokens: 1, output_tokens: 1 } } } },
  ];

  it("submits every item and returns each answer against its own id", async () => {
    client = fakeClient(["ended"], entries);
    const llm = new AnthropicBatchLlm(client as never, async () => {}, () => 0);
    const outcomes = await llm.completeMany([
      { id: "one", request: request() },
      { id: "two", request: request() },
    ]);
    // Results come back in whatever order they finished, so callers match on id.
    expect(outcomes.map((o) => o.id).sort()).toEqual(["one", "two"]);
    expect(outcomes.find((o) => o.id === "one")?.response?.text).toBe("1");
  });

  it("waits while the batch is still running", async () => {
    client = fakeClient(["in_progress", "in_progress", "ended"], entries);
    const llm = new AnthropicBatchLlm(client as never, async () => {}, () => 0);
    await llm.completeMany([{ id: "one", request: request() }]);
    expect(client.messages.batches.retrieve).toHaveBeenCalledTimes(3);
  });

  it("gives up rather than blocking the day, naming the batch it abandoned", async () => {
    client = fakeClient(["in_progress", "in_progress", "in_progress"], entries);
    let clock = 0;
    const llm = new AnthropicBatchLlm(client as never, async () => { clock += 60_000; }, () => clock);
    await expect(llm.completeMany([{ id: "one", request: request() }], { waitMs: 100 })).rejects.toBeInstanceOf(BatchTimeoutError);
  });

  it("does nothing at all for an empty list", async () => {
    client = fakeClient(["ended"], []);
    const llm = new AnthropicBatchLlm(client as never, async () => {}, () => 0);
    expect(await llm.completeMany([])).toEqual([]);
    expect(client.messages.batches.create).not.toHaveBeenCalled();
  });
});
