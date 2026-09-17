import { describe, expect, it } from "vitest";
import { costUsd } from "./pricing";

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
