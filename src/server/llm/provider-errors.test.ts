import { describe, expect, it } from "vitest";
import { describeProviderError, diagnoseProviderError } from "./provider-errors";

describe("diagnoseProviderError", () => {
  it("separates a key that is refused from one that is unknown", () => {
    // The distinction that cost an afternoon: 401 means unknown, 503 with this text means
    // recognised and refused, and only the second points at the workspace.
    const refused = diagnoseProviderError("503 credential validation failed");
    expect(refused.hint).toContain("workspace");
    expect(refused.hint).toContain("separate from the account's credit balance");

    const unknown = diagnoseProviderError("401 invalid x-api-key");
    expect(unknown.hint).toContain("does not recognise");
    expect(unknown.hint).not.toContain("workspace");
  });

  it("names running out of credit only when that is what was said", () => {
    expect(diagnoseProviderError("400 Your credit balance is too low").hint).toContain("out of credit");
    // An org with credit left still gets the refused-key answer, not this one.
    expect(diagnoseProviderError("503 credential validation failed").hint).not.toContain("out of credit");
  });

  it("tells a passing problem from a standing one", () => {
    expect(diagnoseProviderError("429 rate_limit_error").hint).toContain("clears on its own");
    expect(diagnoseProviderError("529 overloaded_error").hint).toContain("Nothing is wrong here");
  });

  it("offers nothing rather than a guess when it does not know", () => {
    expect(diagnoseProviderError("500 internal server error").hint).toBe("");
  });

  it("always keeps the provider's own words", () => {
    for (const raw of ["503 credential validation failed", "429 rate_limit_error", "something new"]) {
      expect(diagnoseProviderError(raw).raw).toBe(raw);
    }
  });

  it("is not confused by case or surrounding whitespace", () => {
    expect(diagnoseProviderError("  503 CREDENTIAL VALIDATION FAILED  ").hint).toContain("workspace");
  });
});

describe("describeProviderError", () => {
  it("puts the provider's words first and ours after", () => {
    const out = describeProviderError("503 credential validation failed");
    expect(out.startsWith("503 credential validation failed")).toBe(true);
    expect(out).toContain("\n");
  });

  it("adds no second line when there is nothing to add", () => {
    expect(describeProviderError("500 internal server error")).toBe("500 internal server error");
  });
});
