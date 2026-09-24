import { describe, expect, it, vi } from "vitest";
import { z } from "zod/v4";
import { BatchTimeoutError, type BatchLlmClient } from "./batch";
import { FakeLlm } from "./fake";
import { runStructuredMany, type LlmCallRecord, type PromptDefinition } from "./structured";
import type { LlmResponse } from "./types";

const PROMPT: PromptDefinition = { role: "test.role", version: "v1", system: "answer" };
const schema = z.object({ score: z.number() });

const answer = (text: string, usage = {}): LlmResponse => ({
  text,
  model: "claude-haiku-4-5",
  usage: { inputTokens: 1000, outputTokens: 100, cacheCreationInputTokens: 0, cacheReadInputTokens: 0, webSearchRequests: 0, ...usage },
  sources: [],
});

function harness(batch: BatchLlmClient, llm = new FakeLlm([])) {
  const records: LlmCallRecord[] = [];
  return {
    records,
    call: { llm, batch, record: async (r: LlmCallRecord) => { records.push(r); }, prompt: PROMPT, schema, model: "claude-haiku-4-5" },
  };
}

describe("runStructuredMany", () => {
  it("returns each answer against its own id, whatever order they arrive in", async () => {
    const batch: BatchLlmClient = { completeMany: async () => [
      { id: "b", response: answer('{"score":2}') },
      { id: "a", response: answer('{"score":1}') },
    ] };
    const { call } = harness(batch);
    const out = await runStructuredMany({ ...call, items: [{ id: "a", user: "1" }, { id: "b", user: "2" }] });
    expect(out.find((r) => r.id === "a")?.output).toEqual({ score: 1 });
    expect(out.find((r) => r.id === "b")?.output).toEqual({ score: 2 });
  });

  it("bills tokens at half, because that is what a batch costs", async () => {
    const batch: BatchLlmClient = { completeMany: async () => [{ id: "a", response: answer('{"score":1}') }] };
    const { call, records } = harness(batch);
    await runStructuredMany({ ...call, items: [{ id: "a", user: "1" }] });
    // 1000 in + 100 out on Haiku is $0.0015 at list; a batch is half of that.
    expect(records[0]!.costUsd).toBeCloseTo(0.00075, 6);
  });

  it("refuses an answer that does not match the schema, and says why", async () => {
    const batch: BatchLlmClient = { completeMany: async () => [
      { id: "a", response: answer('{"score":"not a number"}') },
      { id: "b", response: answer("not json at all") },
    ] };
    const { call, records } = harness(batch);
    const out = await runStructuredMany({ ...call, items: [{ id: "a", user: "1" }, { id: "b", user: "2" }] });
    expect(out.every((r) => r.output === undefined)).toBe(true);
    expect(out.find((r) => r.id === "b")?.error).toContain("not JSON");
    expect(records.every((r) => r.status === "invalid_output")).toBe(true);
  });

  it("keeps the other answers when one request fails", async () => {
    const batch: BatchLlmClient = { completeMany: async () => [
      { id: "a", response: answer('{"score":1}') },
      { id: "b", error: "the request errored: overloaded" },
    ] };
    const { call, records } = harness(batch);
    const out = await runStructuredMany({ ...call, items: [{ id: "a", user: "1" }, { id: "b", user: "2" }] });
    expect(out.find((r) => r.id === "a")?.output).toEqual({ score: 1 });
    expect(out.find((r) => r.id === "b")?.error).toContain("overloaded");
    expect(records.find((r) => r.status === "error")?.error).toContain("overloaded");
  });

  it("asks one at a time when the batch overruns, rather than abandoning the day", async () => {
    const batch: BatchLlmClient = { completeMany: vi.fn(async () => { throw new BatchTimeoutError("batch_1", 1000); }) };
    const llm = new FakeLlm([{ score: 1 }, { score: 2 }]);
    const { call, records } = harness(batch, llm);
    const out = await runStructuredMany({ ...call, items: [{ id: "a", user: "1" }, { id: "b", user: "2" }] });
    expect(out.map((r) => r.output)).toEqual([{ score: 1 }, { score: 2 }]);
    // Full price this time: the fallback is ordinary calls.
    expect(records.every((r) => r.status === "ok")).toBe(true);
    expect(llm.requests).toHaveLength(2);
  });

  it("does nothing for an empty list", async () => {
    const batch: BatchLlmClient = { completeMany: vi.fn(async () => []) };
    const { call } = harness(batch);
    expect(await runStructuredMany({ ...call, items: [] })).toEqual([]);
    expect(batch.completeMany).not.toHaveBeenCalled();
  });
});
