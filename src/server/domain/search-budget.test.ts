import { describe, expect, it } from "vitest";
import {
  CANDIDATES_PER_SEARCH,
  MAX_SEARCHES,
  MIN_SEARCHES,
  escalatedSearches,
  searchesFor,
} from "./search-budget";

describe("searchesFor", () => {
  it("looks only as hard as the work left requires", () => {
    expect(searchesFor(1)).toBe(MIN_SEARCHES);
    expect(searchesFor(CANDIDATES_PER_SEARCH * 2)).toBe(2);
    expect(searchesFor(CANDIDATES_PER_SEARCH * 5)).toBe(5);
  });

  it("never drops below two: one query cross-checks nothing", () => {
    expect(searchesFor(1)).toBe(2);
    expect(searchesFor(CANDIDATES_PER_SEARCH)).toBe(2);
  });

  it("never exceeds the ceiling, however much is wanted", () => {
    expect(searchesFor(1000)).toBe(MAX_SEARCHES);
    expect(searchesFor(Number.MAX_SAFE_INTEGER)).toBe(MAX_SEARCHES);
  });

  it("spends nothing when nothing is needed", () => {
    expect(searchesFor(0)).toBe(0);
    expect(searchesFor(-5)).toBe(0);
  });
});

describe("escalatedSearches", () => {
  it("looks harder after a thin result", () => {
    expect(escalatedSearches(2, 1, 10)).toBe(4);
    expect(escalatedSearches(3, 0, 10)).toBe(6);
  });

  it("does not escalate a call that found a fair share", () => {
    expect(escalatedSearches(2, 5, 10)).toBeNull();
    expect(escalatedSearches(2, 10, 10)).toBeNull();
  });

  it("stops at the ceiling rather than escalating forever", () => {
    expect(escalatedSearches(MAX_SEARCHES, 0, 10)).toBeNull();
    expect(escalatedSearches(6, 0, 10)).toBe(MAX_SEARCHES);
  });

  it("has nothing to escalate when nothing was asked for", () => {
    expect(escalatedSearches(2, 0, 0)).toBeNull();
  });
});
