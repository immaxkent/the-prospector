import { describe, expect, it } from "vitest";
import { PRIOR_RATES, RATE_MIN_SAMPLE, planWorkload, type WorkloadInput } from "./workload";

const base: WorkloadInput = {
  objectiveValue: 6000,
  wonValue: 0,
  dealValue: 500,
  pipeline: [],
  observed: { sent: 0, replies: 0, meetings: 0, wins: 0 },
  dailyCeiling: 20,
  capacityToday: 30,
  daysRemaining: 38,
};

const plan = (over: Partial<WorkloadInput> = {}) => planWorkload({ ...base, ...over });

describe("rates", () => {
  it("uses priors until a sample earns a measured rate, and says which it used", () => {
    const cold = plan();
    expect(cold.rates.source).toBe("prior");
    expect(cold.rates.reply).toBe(PRIOR_RATES.reply);
    expect(cold.notes.join(" ")).toContain("assumed rates");

    const warm = plan({ observed: { sent: 200, replies: 20, meetings: 20, wins: 20 } });
    expect(warm.rates.source).toBe("measured");
    expect(warm.rates.reply).toBe(0.1);
  });

  it("mixes measured and assumed when only some stages have evidence", () => {
    const result = plan({ observed: { sent: 100, replies: 10, meetings: 2, wins: 0 } });
    expect(result.rates.source).toBe("mixed");
    expect(result.rates.reply).toBe(0.1); // measured: 100 sends is enough
    expect(result.rates.winFromMeeting).toBe(PRIOR_RATES.winFromMeeting); // 2 meetings is not
  });

  it("needs a real sample, not one lucky reply", () => {
    const result = plan({ observed: { sent: RATE_MIN_SAMPLE - 1, replies: 5, meetings: 0, wins: 0 } });
    expect(result.rates.reply).toBe(PRIOR_RATES.reply);
  });
});

describe("the pipeline reduces what today has to cover", () => {
  it("counts live conversations against the objective", () => {
    const empty = plan();
    const withPipeline = plan({ pipeline: [{ count: 5, probability: 0.2 }] });
    expect(withPipeline.expectedFromPipeline).toBe(500);
    expect(withPipeline.gap).toBe(empty.gap - 500);
    expect(withPipeline.wanted).toBeLessThan(empty.wanted);
    expect(withPipeline.notes.join(" ")).toContain("already expected to bring");
  });

  it("stops asking for work once the objective is covered", () => {
    const result = plan({ wonValue: 3000, pipeline: [{ count: 30, probability: 0.2 }] });
    expect(result.newProspects).toBe(0);
    expect(result.limitedBy).toBe("objective_met");
    expect(result.notes.join(" ")).toContain("no new prospects are needed");
  });

  it("asks for less as the gap closes", () => {
    const early = plan({ wonValue: 0 });
    const late = plan({ wonValue: 5000 });
    expect(late.wanted).toBeLessThan(early.wanted);
  });
});

describe("ceilings", () => {
  it("never exceeds the operator's cadence", () => {
    const result = plan({ dailyCeiling: 5 });
    expect(result.newProspects).toBe(5);
    expect(result.limitedBy).toBe("cadence");
  });

  it("never exceeds what the mailbox can send today", () => {
    const result = plan({ dailyCeiling: 20, capacityToday: 3 });
    expect(result.newProspects).toBe(3);
    expect(result.limitedBy).toBe("capacity");
    expect(result.notes.join(" ")).toContain("can only send 3 more today");
  });

  it("reports nothing limiting it when the arithmetic fits", () => {
    // A modest gap with plenty of time: the wanted figure is below every ceiling.
    const result = plan({ objectiveValue: 500, daysRemaining: 60, observed: { sent: 200, replies: 60, meetings: 40, wins: 20 } });
    expect(result.limitedBy).toBe("nothing");
    expect(result.newProspects).toBe(result.wanted);
  });
});

describe("honesty about what cannot be done", () => {
  it("says the objective is out of reach rather than aiming at a number nobody can hit", () => {
    const result = plan();
    // At assumed rates a £500 deal needs ~267 prospects per win: 12 wins in 38 days is beyond 20/day.
    expect(result.feasible).toBe(false);
    expect(result.newProspects).toBe(20);
    expect(result.notes.join(" ")).toContain("out of reach at these rates");
  });

  it("is feasible once the rates or the price justify it", () => {
    const result = plan({ dealValue: 5000, observed: { sent: 200, replies: 40, meetings: 30, wins: 15 } });
    expect(result.feasible).toBe(true);
  });

  it("falls back to the stated cadence when there is no deal value to reason from", () => {
    const result = plan({ dealValue: 0 });
    expect(result.limitedBy).toBe("unknowable");
    expect(result.newProspects).toBe(20);
    expect(result.notes.join(" ")).toContain("no deal value");
  });
});

describe("time", () => {
  it("spreads the work over the days that are left", () => {
    const long = plan({ daysRemaining: 60, dailyCeiling: 1000 });
    const short = plan({ daysRemaining: 5, dailyCeiling: 1000 });
    expect(short.wanted).toBeGreaterThan(long.wanted);
  });

  it("treats a finished horizon as one day rather than dividing by zero", () => {
    const result = plan({ daysRemaining: 0, dailyCeiling: 1000 });
    expect(Number.isFinite(result.wanted)).toBe(true);
    expect(result.wanted).toBeGreaterThan(0);
  });
});
