import { describe, expect, it } from "vitest";
import { buildLine } from "./build-info";

describe("buildLine", () => {
  it("reads as a version, a commit and when it was built", () => {
    expect(buildLine({ version: "0.1.42", commit: "74ef691", builtAt: "2026-09-22T21:30:11.000Z" })).toBe(
      "0.1.42 · 74ef691 · built 2026-09-22 21:30 UTC",
    );
  });

  it("says nothing about a build time it does not have", () => {
    expect(buildLine({ version: "dev", commit: "local", builtAt: "" })).toBe("dev · local");
  });
});
