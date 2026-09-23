import { describe, expect, it } from "vitest";
import { capabilitiesOf, thinkingBudget, MIN_THINKING_BUDGET, DEPTH_BUDGET, DEPTH_EFFORT } from "./capabilities";

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

describe("deliberation depth", () => {
  it("spends thinking tokens in proportion to what the role needs", () => {
    expect(thinkingBudget(16_000, "light")).toBe(1200);
    expect(thinkingBudget(16_000, "standard")).toBe(2500);
    expect(thinkingBudget(16_000, "deep")).toBe(4000);
  });

  it("still leaves room for the answer whatever the depth asks for", () => {
    expect(thinkingBudget(3000, "deep")).toBe(1500);
    expect(thinkingBudget(2000, "deep")).toBeNull();
  });

  it("maps depth to an effort level for models that take effort instead", () => {
    expect(DEPTH_EFFORT).toEqual({ light: "low", standard: "medium", deep: "high" });
  });

  it("defaults to deep, so an unstated depth is never quietly cheapened", () => {
    expect(thinkingBudget(16_000)).toBe(DEPTH_BUDGET.deep);
  });
});
