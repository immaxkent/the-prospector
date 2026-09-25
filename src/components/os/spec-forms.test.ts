import { describe, expect, it } from "vitest";
import { FIELD_FORMS, blankItem, coerce, display, withoutEmpties, type Input } from "./spec-forms";

describe("every spec field has a form", () => {
  it("covers each field the operator edits", () => {
    expect(Object.keys(FIELD_FORMS).sort()).toEqual(
      ["buyers", "cadence", "exclusions", "horizon", "objective", "offering", "pricing", "proof"],
    );
  });

  it("offers the allowed options rather than free text where there is a fixed set", () => {
    const pricing = FIELD_FORMS["pricing"]!;
    expect(pricing.kind).toBe("object");
    const model = (pricing as { inputs: Input[] }).inputs.find((i) => i.key === "model")!;
    expect(model.type).toBe("select");
    expect((model as { options: readonly string[] }).options).toContain("day_rate");
  });

  it("gives the horizon a shape per kind, which is what made it unfixable before", () => {
    const horizon = FIELD_FORMS["horizon"]!;
    expect(horizon.kind).toBe("variant");
    const variants = (horizon as { variants: Record<string, unknown> }).variants;
    expect(Object.keys(variants)).toEqual(["sprint", "ongoing"]);
  });
});

describe("coerce", () => {
  const number: Input = { key: "n", label: "N", type: "number" };
  const text: Input = { key: "t", label: "T", type: "text" };
  const strings: Input = { key: "s", label: "S", type: "strings" };

  it("reads a number, and treats an empty box as nothing at all", () => {
    expect(coerce(number, "500")).toBe(500);
    expect(coerce(number, "")).toBeUndefined();
    expect(coerce(number, "   ")).toBeUndefined();
    expect(coerce(number, "not a number")).toBeUndefined();
  });

  it("trims text and drops it when empty, rather than sending an empty string", () => {
    expect(coerce(text, "  hello  ")).toBe("hello");
    expect(coerce(text, "   ")).toBeUndefined();
  });

  it("reads a list one per line, ignoring blank lines", () => {
    expect(coerce(strings, "one\n\n  two  \nthree")).toEqual(["one", "two", "three"]);
    expect(coerce(strings, "")).toEqual([]);
  });
});

describe("display", () => {
  it("shows a list one per line and everything else as itself", () => {
    expect(display({ key: "s", label: "S", type: "strings" }, ["a", "b"])).toBe("a\nb");
    expect(display({ key: "n", label: "N", type: "number" }, 500)).toBe("500");
    expect(display({ key: "t", label: "T", type: "text" }, undefined)).toBe("");
  });
});

describe("withoutEmpties", () => {
  it("drops what an untouched optional input left behind", () => {
    expect(withoutEmpties({ model: "package", amount: undefined, currency: "" })).toEqual({ model: "package" });
  });

  it("keeps a zero, which is a real answer", () => {
    expect(withoutEmpties({ dailyFollowupTarget: 0 })).toEqual({ dailyFollowupTarget: 0 });
  });
});

describe("blankItem", () => {
  it("makes something the inputs can fill straight away", () => {
    const inputs = (FIELD_FORMS["proof"] as { inputs: Input[] }).inputs;
    expect(blankItem(inputs)).toEqual({ kind: "repo", title: "", url: "", claim: "" });
  });
});
