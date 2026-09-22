import { describe, expect, it } from "vitest";
import { costUsd, basePriceKey } from "./pricing";

const zero = { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0, webSearchRequests: 0 };

describe("costUsd", () => {
  it("prices input and output tokens per model", () => {
    expect(costUsd("claude-opus-5", { ...zero, inputTokens: 1_000_000, outputTokens: 100_000 })).toBe(7.5);
    expect(costUsd("claude-sonnet-5", { ...zero, inputTokens: 1_000_000 })).toBe(2);
  });

  it("prices cache writes, cache reads and web searches", () => {
    expect(costUsd("claude-opus-5", { ...zero, cacheCreationInputTokens: 1_000_000 })).toBe(6.25);
    expect(costUsd("claude-opus-5", { ...zero, cacheReadInputTokens: 1_000_000 })).toBe(0.5);
    expect(costUsd("claude-opus-5", { ...zero, webSearchRequests: 3 })).toBe(0.03);
  });

  it("never understates an unknown model", () => {
    expect(costUsd("claude-future-9", { ...zero, inputTokens: 1_000_000 })).toBe(5);
  });
});

describe("dated model variants", () => {
  it("prices the dated name the API returns as the model it is", () => {
    const usage = { inputTokens: 1_000_000, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0, webSearchRequests: 0 };
    expect(costUsd("claude-haiku-4-5-20251001", usage)).toBe(costUsd("claude-haiku-4-5", usage));
    expect(costUsd("claude-sonnet-5-20260101", usage)).toBe(costUsd("claude-sonnet-5", usage));
    expect(basePriceKey("claude-haiku-4-5-20251001")).toBe("claude-haiku-4-5");
  });

  it("still charges the top rate for a model it genuinely does not know", () => {
    const usage = { inputTokens: 1_000_000, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0, webSearchRequests: 0 };
    // Never understate spend for something unrecognised.
    expect(costUsd("some-future-model", usage)).toBe(5);
  });
});
