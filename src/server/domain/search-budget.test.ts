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
  it("looks harder after a thin result that used up its budget", () => {
    expect(escalatedSearches(2, 1, 10, 2)).toBe(4);
    expect(escalatedSearches(3, 0, 10, 3)).toBe(6);
  });

  it("will not pay to look again when the budget went unspent", () => {
    // The model stopped searching of its own accord: the segment is thin, not under-searched.
    expect(escalatedSearches(4, 1, 10, 1)).toBeNull();
    expect(escalatedSearches(8, 0, 10, 2)).toBeNull();
  });

  it("does not escalate a call that found a fair share", () => {
    expect(escalatedSearches(2, 5, 10, 2)).toBeNull();
    expect(escalatedSearches(2, 10, 10, 2)).toBeNull();
  });

  it("stops at the ceiling rather than escalating forever", () => {
    expect(escalatedSearches(MAX_SEARCHES, 0, 10, MAX_SEARCHES)).toBeNull();
    expect(escalatedSearches(6, 0, 10, 6)).toBe(MAX_SEARCHES);
  });

  it("has nothing to escalate when nothing was asked for", () => {
    expect(escalatedSearches(2, 0, 0, 2)).toBeNull();
  });
});
