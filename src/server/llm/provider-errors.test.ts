import { describe, expect, it } from "vitest";
import { describeProviderError, diagnoseProviderError } from "./provider-errors";

describe("diagnoseProviderError", () => {
  it("reads a failed validation as unavailable, not as a bad key", () => {
    // Misread once, live: 503 is service-unavailable, and the advice that followed sent the
    // operator through their billing settings while Anthropic quietly recovered.
    const unavailable = diagnoseProviderError("503 credential validation failed");
    expect(unavailable.hint).toContain("not the same as rejecting it");
    expect(unavailable.hint).toContain("retry before changing anything");

    const unknown = diagnoseProviderError("401 invalid x-api-key");
    expect(unknown.hint).toContain("does not recognise");
  });

  it("does not send the reader to their billing settings first", () => {
    // A hint that leads with the account is the mistake this exists to stop repeating.
    const hint = diagnoseProviderError("503 credential validation failed").hint;
    expect(hint.indexOf("retry")).toBeLessThan(hint.indexOf("spend limit"));
  });

  it("names running out of credit only when that is what was said", () => {
    expect(diagnoseProviderError("400 Your credit balance is too low").hint).toContain("out of credit");
    // A validation outage is not a credit problem and must not be described as one.
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
