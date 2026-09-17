import { describe, expect, it } from "vitest";
import { ID_PREFIXES, newId } from "./ids";

describe("newId", () => {
  it("uses the kind prefix and a fixed length", () => {
    const id = newId("prospect");
    expect(id).toMatch(/^pro_[0-9a-hjkmnp-tv-z]{22}$/);
  });

  it("sorts by creation time", () => {
    const earlier = newId("message", 1_000_000);
    const later = newId("message", 2_000_000);
    expect([later, earlier].sort()).toEqual([earlier, later]);
  });

  it("does not collide across many ids", () => {
    const ids = new Set(Array.from({ length: 5000 }, () => newId("evidence", 42)));
    expect(ids.size).toBe(5000);
  });

  it("has unique prefixes", () => {
    const prefixes = Object.values(ID_PREFIXES);
    expect(new Set(prefixes).size).toBe(prefixes.length);
  });
});
