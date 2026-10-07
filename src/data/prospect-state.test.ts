import { describe, expect, it } from "vitest";
import type { Prospect } from "./types";
import {
  cannotBeContacted,
  countDecisions,
  orderByDecision,
  prospectDecision,
  reachOf,
} from "./prospect-state";

const prospect = (over: Partial<Prospect>): Prospect =>
  ({
    id: "p1",
    endeavourId: "e1",
    score: 70,
    scoreFactors: [],
    person: "A",
    role: "",
    company: "Co",
    segment: "",
    trigger: "",
    evidence: [],
    fitFactors: [],
    stage: "qualified",
    lastTouch: null,
    nextAction: "",
    opportunityValue: null,
    status: "QUALIFIED",
    scoreReason: "",
    contacts: [{ channel: "email", value: "ada@co.com" }],
    companyId: "c1",
    releasedAt: null,
    ...over,
  }) as Prospect;

describe("reachOf", () => {
  it("ranks a named address above a generic inbox", () => {
    expect(reachOf([{ channel: "email", value: "ada@co.com" }])).toBe("named");
    expect(reachOf([{ channel: "email", value: "hello@co.com" }])).toBe("inbox");
  });

  it("prefers the named address when both are on record", () => {
    expect(reachOf([{ channel: "email", value: "info@co.com" }, { channel: "email", value: "ada@co.com" }])).toBe("named");
  });

  it("counts a handle as a route, because a person can open it", () => {
    expect(reachOf([{ channel: "discord", value: "co#1" }])).toBe("handle");
    expect(reachOf([{ channel: "linkedin", value: "https://x/y" }])).toBe("handle");
  });

  it("says none when there is nothing, including when a value is blank", () => {
    expect(reachOf([])).toBe("none");
    expect(reachOf([{ channel: "email", value: "  " }])).toBe("none");
  });

  it("only calls none uncontactable", () => {
    expect(cannotBeContacted("none")).toBe(true);
    expect(cannotBeContacted("handle")).toBe(false);
  });
});

describe("prospectDecision", () => {
  it("calls an unscored prospect unjudged rather than waiting on anyone", () => {
    const d = prospectDecision(prospect({ score: null, status: "QUALIFIED" }));
    expect(d).toMatchObject({ state: "unjudged", needsDecision: false });
    expect(d.reason).toContain("not scored yet");
  });

  it("distinguishes found from being researched", () => {
    expect(prospectDecision(prospect({ status: "DISCOVERED" })).reason).toContain("not looked at");
    expect(prospectDecision(prospect({ status: "RESEARCHING" })).reason).toContain("being researched");
  });

  it("puts a scored, unreleased prospect on the operator", () => {
    const d = prospectDecision(prospect({ score: 82 }));
    expect(d).toMatchObject({ state: "undecided", needsDecision: true, reach: "named" });
    expect(d.reason).toBe("scored 82, waiting on you");
  });

  it("says in the reason when there is no route to reach them", () => {
    const d = prospectDecision(prospect({ score: 90, contacts: [] }));
    expect(d.state).toBe("undecided");
    expect(d.reason).toContain("no route");
    expect(d.reachNote).toBe("no route found");
  });

  it("ranks a review flag above the score", () => {
    expect(prospectDecision(prospect({ status: "NEEDS_REVIEW" })).reason).toBe("flagged for review");
  });

  it("takes a released prospect off the desk without refusing it", () => {
    const d = prospectDecision(prospect({ releasedAt: "2026-10-01T09:00:00Z" }));
    expect(d).toMatchObject({ state: "accepted", needsDecision: false });
  });

  it("gives the rejection reason when there is one", () => {
    expect(prospectDecision(prospect({ status: "REJECTED", scoreReason: "no fit" })).reason).toBe("rejected — no fit");
    expect(prospectDecision(prospect({ status: "REJECTED" })).reason).toBe("rejected");
  });

  it("reports a rejection even once it was released, because refusal is the later fact", () => {
    const d = prospectDecision(prospect({ status: "REJECTED", releasedAt: "2026-10-01T09:00:00Z" }));
    expect(d.state).toBe("declined");
  });
});

describe("orderByDecision", () => {
  it("puts what needs a decision first, then what is coming, then what is done", () => {
    const rows = orderByDecision([
      prospect({ id: "declined", status: "REJECTED" }),
      prospect({ id: "accepted", releasedAt: "2026-10-01T09:00:00Z" }),
      prospect({ id: "unjudged", score: null }),
      prospect({ id: "undecided", score: 60 }),
    ]);
    expect(rows.map((r) => r.id)).toEqual(["undecided", "unjudged", "accepted", "declined"]);
  });

  it("orders the decisions by flag, then by whether they can be reached, then by score", () => {
    const rows = orderByDecision([
      prospect({ id: "low", score: 51 }),
      prospect({ id: "unreachable", score: 99, contacts: [] }),
      prospect({ id: "high", score: 88 }),
      prospect({ id: "flagged", score: 40, status: "NEEDS_REVIEW" }),
    ]);
    // A 99 with no route to the company is not the first thing worth attention.
    expect(rows.map((r) => r.id)).toEqual(["flagged", "high", "low", "unreachable"]);
  });

  it("shows the most recently released first", () => {
    const rows = orderByDecision([
      prospect({ id: "older", releasedAt: "2026-09-30T09:00:00Z" }),
      prospect({ id: "newer", releasedAt: "2026-10-02T09:00:00Z" }),
    ]);
    expect(rows.map((r) => r.id)).toEqual(["newer", "older"]);
  });

  it("keeps ties in the order they arrived", () => {
    const rows = orderByDecision([
      prospect({ id: "first", score: 70 }),
      prospect({ id: "second", score: 70 }),
    ]);
    expect(rows.map((r) => r.id)).toEqual(["first", "second"]);
  });

  it("carries the decision onto each row so a screen does not derive it twice", () => {
    const [row] = orderByDecision([prospect({ score: 82 })]);
    expect(row?.decision.reason).toBe("scored 82, waiting on you");
  });

  it("leaves the input alone", () => {
    const input = [prospect({ id: "a", status: "REJECTED" }), prospect({ id: "b" })];
    orderByDecision(input);
    expect(input.map((p) => p.id)).toEqual(["a", "b"]);
  });
});

describe("countDecisions", () => {
  it("counts each state once, and says how many decisions are stuck for want of a contact", () => {
    expect(
      countDecisions([
        prospect({ score: 80 }),
        prospect({ score: 70, contacts: [] }),
        prospect({ score: null }),
        prospect({ releasedAt: "2026-10-01T09:00:00Z" }),
        prospect({ status: "REJECTED" }),
      ]),
    ).toEqual({ needsDecision: 2, unjudged: 1, accepted: 1, declined: 1, unreachable: 1 });
  });

  it("counts nothing from nothing", () => {
    expect(countDecisions([])).toEqual({ needsDecision: 0, unjudged: 0, accepted: 0, declined: 0, unreachable: 0 });
  });
});
