import { describe, expect, it } from "vitest";
import { outputSnippet } from "./structured";

describe("outputSnippet", () => {
  it("returns short output whole", () => {
    expect(outputSnippet('{"candidates":[]}')).toBe('{"candidates":[]}');
  });

  it("says so when there was nothing at all, rather than showing empty quotes", () => {
    expect(outputSnippet("")).toBe("(empty response)");
    expect(outputSnippet("   \n  ")).toBe("(empty response)");
  });

  it("keeps both ends, because a preamble shows at the head and a truncation at the tail", () => {
    const text = `PREAMBLE${"x".repeat(2000)}TAIL`;
    const snippet = outputSnippet(text, 20);
    expect(snippet.startsWith("PREAMBLE")).toBe(true);
    expect(snippet.endsWith("TAIL")).toBe(true);
    expect(snippet).toContain("more characters");
  });

  it("never grows the thing it is shortening", () => {
    const text = "y".repeat(10_000);
    expect(outputSnippet(text, 400).length).toBeLessThan(text.length);
  });

  it("does not claim elision when the text only just fits", () => {
    const text = "z".repeat(40);
    expect(outputSnippet(text, 20)).toBe(text);
  });

  it("shows the shape of the failure that prompted it", () => {
    // Prose wrapped round the object is the case this exists for: the head shows the
    // apology, the tail shows whether any JSON was ever produced.
    const text = `I couldn't find enough sources.${" ".repeat(1200)}{"candidates":[],"searchNotes":"none"}`;
    const snippet = outputSnippet(text, 40);
    expect(snippet).toContain("I couldn't find");
    expect(snippet).toContain("searchNotes");
  });
});
