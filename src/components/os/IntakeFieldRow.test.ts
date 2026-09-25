import { describe, expect, it } from "vitest";
import { withoutComments } from "./IntakeFieldRow";

describe("withoutComments", () => {
  it("strips the explanatory notes so the example parses as JSON", () => {
    const example = `{
  "model": "package",
  "expectedDeal": 2400
}

// expectedDeal — what a typical engagement is worth.
// amount — only for work with one fixed price.`;
    expect(() => JSON.parse(example)).toThrow();
    expect(JSON.parse(withoutComments(example))).toEqual({ model: "package", expectedDeal: 2400 });
  });

  it("leaves a value that happens to contain a slash alone", () => {
    const json = '{"url":"https://arcaidia.io"}';
    expect(JSON.parse(withoutComments(json))).toEqual({ url: "https://arcaidia.io" });
  });

  it("leaves ordinary JSON untouched", () => {
    expect(withoutComments('{"a":1}')).toBe('{"a":1}');
  });
});
