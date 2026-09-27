import { describe, expect, it } from "vitest";
import { fieldChoices } from "./spec-forms";

describe("fieldChoices", () => {
  it("offers every pricing model the schema accepts", () => {
    expect(fieldChoices("pricing").map((c) => c.value)).toEqual([
      "day_rate",
      "package",
      "retainer",
      "subscription",
      "rev_share",
      "free",
    ]);
  });

  it("leaves currency out: the question is about the model, not the money", () => {
    expect(fieldChoices("pricing").map((c) => c.value)).not.toContain("GBP");
    expect(fieldChoices("objective").map((c) => c.value)).not.toContain("GBP");
  });

  it("offers a variant's kinds, which are the whole choice for that field", () => {
    expect(fieldChoices("horizon")).toEqual([
      { value: "sprint", label: "Kind" },
      { value: "ongoing", label: "Kind" },
    ]);
  });

  it("names which input each word belongs to, so a choice is not ambiguous", () => {
    expect(fieldChoices("objective").every((c) => c.label === "Measured in")).toBe(true);
    expect(fieldChoices("proof").every((c) => c.label === "Kind")).toBe(true);
  });

  it("is empty for fields that are free prose", () => {
    expect(fieldChoices("offering")).toEqual([]);
    expect(fieldChoices("cadence")).toEqual([]);
  });

  it("is empty for a field with no form at all", () => {
    expect(fieldChoices("mailboxId")).toEqual([]);
    expect(fieldChoices("nonsense")).toEqual([]);
  });
});
