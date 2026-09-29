import { describe, expect, it, vi } from "vitest";

// Both are server functions; importing them for real drags the server runtime into a unit
// test. Only the query options are under test here.
vi.mock("@/api/dataset", () => ({ fetchDataset: vi.fn() }));
vi.mock("@/api/session", () => ({ fetchSession: vi.fn() }));

const { SESSION_STALE_MS, datasetQuery, sessionQuery } = await import("./queries");

describe("sessionQuery", () => {
  it("is cached, so a navigation does not wait on the server to ask who you are", () => {
    // The regression this guards: the root route awaits the session before any screen
    // renders. With no staleTime that was a round-trip in front of every click, which read
    // as the page flashing and then loading again.
    expect(sessionQuery.staleTime).toBe(SESSION_STALE_MS);
    expect(SESSION_STALE_MS).toBeGreaterThan(0);
  });

  it("does not cache so long that signing out elsewhere goes unnoticed", () => {
    expect(SESSION_STALE_MS).toBeLessThanOrEqual(60_000);
  });

  it("keeps its own key, so invalidating the dataset does not re-ask for the session", () => {
    expect(sessionQuery.queryKey).toEqual(["session"]);
    expect(datasetQuery.queryKey).toEqual(["dataset"]);
  });
});
