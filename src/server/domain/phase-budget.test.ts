import { describe, expect, it } from "vitest";
import {
  PHASE_ORDER,
  phaseAllowancePence,
  phaseBudgets,
  phaseExhausted,
  phaseOf,
  phaseVerdict,
} from "./phase-budget";

describe("phaseOf", () => {
  it("maps each call a run makes to the phase that made it", () => {
    expect(phaseOf("research.discover")).toBe("research");
    expect(phaseOf("research.qualify")).toBe("qualify");
    expect(phaseOf("outreach.draft")).toBe("draft");
    expect(phaseOf("conversation.classify")).toBe("reply");
  });

  it("leaves work no run does to the day's budget alone", () => {
    // A person is waiting on intake, and the weekly review is a few hundred tokens.
    expect(phaseOf("intake.planner")).toBeNull();
    expect(phaseOf("report.review")).toBeNull();
    expect(phaseOf("something.new")).toBeNull();
  });
});

describe("phaseBudgets", () => {
  it("adds up to the allowance, with nothing lost to rounding", () => {
    // On a 48p day the pence matter: dropping three of them is six per cent of the budget.
    for (const allowance of [48, 50, 100, 7, 1, 333]) {
      const budgets = phaseBudgets(allowance);
      expect(PHASE_ORDER.reduce((sum, p) => sum + budgets[p], 0)).toBe(allowance);
    }
  });

  it("gives research the largest share, because its appetite is the unbounded one", () => {
    const budgets = phaseBudgets(100);
    expect(budgets.research).toBeGreaterThan(budgets.qualify);
    expect(budgets.research).toBeGreaterThan(budgets.draft);
    expect(budgets).toEqual({ reply: 10, research: 45, qualify: 25, draft: 20 });
  });

  it("reserves something for qualification on the day that broke", () => {
    // The whole point. 48p is a £15 month; research took all of it and nothing was scored.
    expect(phaseBudgets(48).qualify).toBeGreaterThan(0);
    expect(phaseBudgets(48).research).toBeLessThan(48);
  });

  it("gives nothing away when there is nothing", () => {
    expect(phaseBudgets(0)).toEqual({ reply: 0, research: 0, qualify: 0, draft: 0 });
    expect(phaseBudgets(-5)).toEqual({ reply: 0, research: 0, qualify: 0, draft: 0 });
  });
});

describe("phaseAllowancePence", () => {
  it("is just the share when every earlier phase spent all of its own", () => {
    expect(phaseAllowancePence("qualify", 100, { reply: 10, research: 45 })).toBe(25);
  });

  it("hands on what the phases before it did not use", () => {
    // A quiet morning with no replies would otherwise simply lose that tenth of the day.
    expect(phaseAllowancePence("research", 100, { reply: 0 })).toBe(55);
    expect(phaseAllowancePence("qualify", 100, { reply: 0, research: 20 })).toBe(60);
  });

  it("does not let surplus flow backwards", () => {
    // Draft has not run, so research cannot have what draft will not spend.
    expect(phaseAllowancePence("research", 100, { reply: 10, draft: 0 })).toBe(45);
  });

  it("gives the first phase exactly its share, with nothing before it to inherit", () => {
    expect(phaseAllowancePence("reply", 100, {})).toBe(10);
  });

  it("treats an overspent earlier phase as having no surplus, not a negative one", () => {
    expect(phaseAllowancePence("qualify", 100, { reply: 30, research: 45 })).toBe(25);
  });
});

describe("phaseVerdict", () => {
  it("allows a phase that has not used its share", () => {
    expect(phaseVerdict("qualify", 100, { reply: 10, research: 45, qualify: 10 })).toMatchObject({
      allowed: true,
      allowancePence: 25,
      spentPence: 10,
    });
  });

  it("stops a phase at its own share even when the day has money left", () => {
    // Research stopping does not mean the day is over — that is the entire fix.
    expect(phaseVerdict("research", 100, { reply: 10, research: 45 }).allowed).toBe(false);
    expect(phaseVerdict("qualify", 100, { reply: 10, research: 45 }).allowed).toBe(true);
  });

  it("says so against the phase's own name", () => {
    const verdict = phaseVerdict("research", 100, { reply: 10, research: 45 });
    expect(phaseExhausted("research", verdict)).toBe(
      "research has spent its share of today (45p of 45p); the other phases keep theirs",
    );
  });
});
