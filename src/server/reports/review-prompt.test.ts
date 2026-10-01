import { describe, expect, it } from "vitest";
import { REVIEW_PROMPT, renderReviewInput } from "./review-prompt";
import type { ReviewFacts } from "./review";

const facts: ReviewFacts = {
  endeavourId: "end_1",
  endeavourName: "£3K Solidity Sprint",
  followUp: [{ prospectId: "a", company: "A", days: 9 }, { prospectId: "b", company: "B", days: 2 }],
  decide: [],
  silent: [{ prospectId: "c", company: "C", days: 20 }],
  offChannel: [],
  segments: [{ name: "Launch-stage", pending: 12, share: 17, sent: 40, replies: 6 }],
  pending: 31,
  pendingCap: 50,
  active: 6,
  activeGoal: 20,
  minSample: 15,
  objectiveWarning: null,
  allocation: { mode: "even" as const, armed: false, shortBy: 0, spread: null },
};

describe("the review prompt", () => {
  it("forbids a number the model was not given", () => {
    // The lists below it are exact. A covering sentence that invents a figure is worse than
    // none, because nothing distinguishes a counted number from a recalled one.
    expect(REVIEW_PROMPT.system).toContain("Never state a number that is not in the input");
  });

  it("asks for the sentence, not the data", () => {
    expect(REVIEW_PROMPT.system).toContain("Do not repeat the lists");
  });
});

describe("renderReviewInput", () => {
  it("hands over every figure the sentence could need, including the oldest wait", () => {
    const text = renderReviewInput(facts);
    expect(text).toContain("Replies waiting on the operator: 2 (oldest 9 days)");
    expect(text).toContain("Pending buffer: 31 of 50");
    expect(text).toContain("Launch-stage (40 sent, 6 replies)");
  });

  it("says none rather than leaving a line dangling", () => {
    expect(renderReviewInput({ ...facts, segments: [] })).toContain("Segments: none");
  });
});
