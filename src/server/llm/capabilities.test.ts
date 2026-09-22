import { describe, expect, it } from "vitest";
import { capabilitiesOf, thinkingBudget, MIN_THINKING_BUDGET } from "./capabilities";

describe("model capabilities", () => {
  it("knows Haiku 4.5 takes a thinking budget, no effort, and the older search tool", () => {
    expect(capabilitiesOf("claude-haiku-4-5")).toEqual({
      thinking: "budget",
      effort: false,
      webSearchTool: "web_search_20250305",
    });
  });

  it("knows the current models take adaptive thinking, effort and the current search tool", () => {
    for (const model of ["claude-opus-5", "claude-sonnet-5"]) {
      expect(capabilitiesOf(model)).toMatchObject({
        thinking: "adaptive",
        effort: true,
        webSearchTool: "web_search_20260209",
      });
    }
  });

  it("assumes an unknown model is current rather than ancient", () => {
    expect(capabilitiesOf("claude-something-6").thinking).toBe("adaptive");
  });
});

describe("thinkingBudget", () => {
  it("leaves room for the answer", () => {
    expect(thinkingBudget(16_000)).toBe(4000);
    expect(thinkingBudget(6000)).toBe(3000);
    expect(thinkingBudget(2048)).toBe(1024);
  });

  it("is null when there is no room for the minimum", () => {
    expect(thinkingBudget(2046)).toBeNull();
    expect(thinkingBudget(256)).toBeNull();
    expect(MIN_THINKING_BUDGET).toBe(1024);
  });
});
