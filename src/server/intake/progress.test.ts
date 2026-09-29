import { beforeEach, describe, expect, it } from "vitest";
import { PLAN_TTL_MS, endPlan, inFlightPlans, notePass, readPlan, startPlan } from "./progress";

const T0 = 1_000_000;

beforeEach(() => {
  // The map is module state; each test starts from whatever the last one left.
  for (const id of ["a", "b", "c", "old", "gone"]) endPlan(id);
});

describe("startPlan", () => {
  it("opens a plan with nothing done yet", () => {
    startPlan("a", 4, T0);
    expect(readPlan("a", T0)).toEqual({ done: [], total: 4, startedAt: T0 });
  });

  it("ignores an empty id rather than keeping an unreachable entry", () => {
    const before = inFlightPlans();
    startPlan("", 4, T0);
    expect(inFlightPlans()).toBe(before);
  });
});

describe("notePass", () => {
  it("records passes in the order they finished", () => {
    startPlan("a", 4, T0);
    notePass("a", "pricing");
    notePass("a", "objective");
    expect(readPlan("a", T0)?.done).toEqual(["pricing", "objective"]);
  });

  it("counts a pass once, however often it is noted", () => {
    startPlan("a", 4, T0);
    notePass("a", "proof");
    notePass("a", "proof");
    expect(readPlan("a", T0)?.done).toEqual(["proof"]);
  });

  it("ignores a note for a plan nobody started", () => {
    // A stale retry, or a client that walked away. Creating an entry would keep a phantom
    // plan alive for the whole window.
    notePass("gone", "proof");
    expect(readPlan("gone", T0)).toBeNull();
  });
});

describe("readPlan", () => {
  it("is null for an id that was never started", () => {
    expect(readPlan("c", T0)).toBeNull();
  });

  it("hands back a copy, so a reader cannot edit what is in flight", () => {
    startPlan("a", 4, T0);
    const read = readPlan("a", T0)!;
    read.done.push("invented");
    expect(readPlan("a", T0)?.done).toEqual([]);
  });

  it("forgets a plan once it is older than the window", () => {
    startPlan("old", 4, T0);
    expect(readPlan("old", T0 + PLAN_TTL_MS - 1)).not.toBeNull();
    expect(readPlan("old", T0 + PLAN_TTL_MS + 1)).toBeNull();
  });
});

describe("housekeeping", () => {
  it("sweeps stale plans when a new one starts, so nothing accumulates", () => {
    startPlan("old", 4, T0);
    startPlan("a", 4, T0 + PLAN_TTL_MS + 1);
    expect(readPlan("old", T0 + PLAN_TTL_MS + 1)).toBeNull();
    expect(readPlan("a", T0 + PLAN_TTL_MS + 1)).not.toBeNull();
  });

  it("drops a plan the moment its call returns", () => {
    startPlan("a", 4, T0);
    endPlan("a");
    expect(readPlan("a", T0)).toBeNull();
  });

  it("survives ending a plan that was never there", () => {
    expect(() => endPlan("never")).not.toThrow();
  });
});
