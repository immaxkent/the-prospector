import { describe, expect, it } from "vitest";
import { StageTransitionError, assertTransition, canTransition } from "./pipeline";

describe("system transitions", () => {
  it("move forward, including skipping stages", () => {
    expect(canTransition("discovered", "researched", "system")).toBe(true);
    expect(canTransition("contacted", "meeting", "system")).toBe(true);
  });

  it("never move backward or stay put", () => {
    expect(canTransition("replied", "contacted", "system")).toBe(false);
    expect(canTransition("qualified", "qualified", "system")).toBe(false);
  });

  it("can park a prospect as lost or nurture, but never reopen terminal stages", () => {
    expect(canTransition("proposal", "lost", "system")).toBe(true);
    expect(canTransition("replied", "nurture", "system")).toBe(true);
    expect(canTransition("won", "nurture", "system")).toBe(false);
    expect(canTransition("lost", "contacted", "system")).toBe(false);
  });

  it("revive nurture only through new contact or a reply", () => {
    expect(canTransition("nurture", "contacted", "system")).toBe(true);
    expect(canTransition("nurture", "replied", "system")).toBe(true);
    expect(canTransition("nurture", "won", "system")).toBe(false);
  });
});

describe("user transitions", () => {
  it("may correct any stage, including reopening", () => {
    expect(canTransition("won", "proposal", "user")).toBe(true);
    expect(canTransition("lost", "qualified", "user")).toBe(true);
    expect(canTransition("won", "won", "user")).toBe(false);
  });
});

describe("assertTransition", () => {
  it("throws a typed error on an illegal move", () => {
    expect(() => assertTransition("won", "lost", "system")).toThrow(StageTransitionError);
    expect(() => assertTransition("qualified", "contacted", "system")).not.toThrow();
  });
});
