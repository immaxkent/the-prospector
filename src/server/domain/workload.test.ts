import { describe, expect, it } from "vitest";
import {
  PRIOR_RATES,
  RATE_MIN_SAMPLE,
  activeConversationsNeeded,
  objectiveWarning,
  planWorkload,
  rateObservations,
  type WorkloadInput,
} from "./workload";

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

describe("what a deal is worth", () => {
  it("says so when the forecast is running on the minimum you would accept", () => {
    const result = plan({ dealValue: 95, dealValueSource: "minimum" });
    expect(result.notes.join(" ")).toContain("pessimistic case");
    // A floor makes the objective look far harder than a typical deal would.
    expect(result.wanted).toBeGreaterThan(plan({ dealValue: 2000, dealValueSource: "expected" }).wanted);
  });

  it("prefers evidence once deals have actually been won, and says it is evidence", () => {
    const result = plan({ dealValue: 2400, dealValueSource: "measured" });
    expect(result.notes.join(" ")).toContain("on the evidence of the ones actually won");
  });

  it("a bigger typical deal closes the gap with less work", () => {
    const small = plan({ dealValue: 500, dealValueSource: "expected", dailyCeiling: 1000 });
    const large = plan({ dealValue: 6000, dealValueSource: "expected", dailyCeiling: 1000 });
    expect(large.wanted).toBeLessThan(small.wanted);
  });
});

describe("objectives that are not measured in money", () => {
  /** "Five partnerships by December" — each win counts once, and there is no price. */
  const partnerships = (over: Partial<WorkloadInput> = {}) =>
    plan({ unit: "count", objectiveValue: 5, wonValue: 0, dealValue: 1, dailyCeiling: 20, daysRemaining: 60, ...over });

  it("asks for work, rather than deciding it is already finished", () => {
    const result = partnerships();
    // The bug this replaces: a non-revenue objective was valued at zero and looked complete.
    expect(result.limitedBy).not.toBe("objective_met");
    expect(result.newProspects).toBeGreaterThan(0);
    expect(result.gap).toBe(5);
  });

  it("counts each win once instead of pricing it", () => {
    const result = partnerships({ wonValue: 3 });
    expect(result.gap).toBe(2);
    expect(result.notes.join(" ")).toContain("each one counts once");
    expect(result.notes.join(" ")).not.toContain("pessimistic case");
  });

  it("is finished when enough have been won", () => {
    expect(partnerships({ wonValue: 5 }).limitedBy).toBe("objective_met");
  });

  it("counts live conversations towards the target, as revenue does", () => {
    const withPipeline = partnerships({ pipeline: [{ count: 10, probability: 0.2 }] });
    expect(withPipeline.expectedFromPipeline).toBe(2);
    expect(withPipeline.gap).toBe(3);
  });
});

describe("rateObservations", () => {
  const sentTo = (prospectId: string) => ({ prospectId, direction: "outbound" as const, sendState: "sent" });
  const replyFrom = (prospectId: string) => ({ prospectId, direction: "inbound" as const });

  it("counts a prospect that was emailed and got there", () => {
    const observed = rateObservations(
      [{ id: "p1", stage: "meeting" }, { id: "p2", stage: "won" }],
      [sentTo("p1"), sentTo("p2"), replyFrom("p1")],
    );
    expect(observed).toEqual({ sent: 2, replies: 1, meetings: 2, wins: 1 });
  });

  it("leaves out a prospect nobody emailed, however far it got", () => {
    // The failure this prevents: a prospect reached on Discord and carried to a meeting
    // raises the meeting rate while never having been a reply, so the arithmetic decides a
    // higher share of replies become meetings and asks for fewer prospects.
    const emailed = rateObservations([{ id: "p1", stage: "meeting" }], [sentTo("p1"), replyFrom("p1")]);
    const withDiscord = rateObservations(
      [{ id: "p1", stage: "meeting" }, { id: "p2", stage: "meeting" }],
      [sentTo("p1"), replyFrom("p1")],
    );
    expect(withDiscord).toEqual(emailed);
    expect(withDiscord.meetings).toBe(1);
  });

  it("does not count a win nobody was emailed about either", () => {
    expect(rateObservations([{ id: "p1", stage: "won" }], []).wins).toBe(0);
  });

  it("does not count a draft as a send", () => {
    expect(rateObservations([{ id: "p1", stage: "contacted" }], [{ prospectId: "p1", direction: "outbound", sendState: "draft" }]).sent).toBe(0);
  });

  it("counts a prospect once however many replies it sent", () => {
    expect(rateObservations([{ id: "p1", stage: "replied" }], [sentTo("p1"), replyFrom("p1"), replyFrom("p1")]).replies).toBe(1);
  });

  it("ignores messages belonging to prospects that are not ours", () => {
    expect(rateObservations([{ id: "p1", stage: "contacted" }], [replyFrom("someone_else")]).replies).toBe(0);
  });
});

describe("whether the setpoints can reach the objective", () => {
  const rates = { reply: 0.05, meetingFromReply: 0.3, winFromMeeting: 0.25, perProspect: 0.00375, source: "prior" as const };

  it("works out how many conversations the gap actually needs", () => {
    // £6,000 left at £2,400 a deal is 2.5 wins; at 0.3 × 0.25 that is 34 conversations.
    expect(activeConversationsNeeded(6000, 2400, rates)).toBe(34);
  });

  it("needs none once the objective is covered", () => {
    expect(activeConversationsNeeded(0, 2400, rates)).toBe(0);
  });

  it("says nothing rather than dividing by nothing", () => {
    // No deal value, or a conversion of zero: silence is the honest answer, not a warning
    // built on arithmetic that cannot be done.
    expect(activeConversationsNeeded(6000, 0, rates)).toBeNull();
    expect(activeConversationsNeeded(6000, 2400, { ...rates, winFromMeeting: 0 })).toBeNull();
  });

  it("stays quiet when the goal is enough", () => {
    expect(objectiveWarning(12, 20, "measured")).toBeNull();
    expect(objectiveWarning(20, 20, "measured")).toBeNull();
    expect(objectiveWarning(null, 20, "measured")).toBeNull();
  });

  it("says what the goal would have to be, and on what basis", () => {
    // Measured and assumed are different advice: one says raise the goal, the other says
    // the number is a guess that the first replies will move.
    expect(objectiveWarning(34, 20, "measured")).toContain("on your measured rates, that needs about 34");
    expect(objectiveWarning(34, 20, "prior")).toContain("which the first replies will correct");
    expect(objectiveWarning(34, 20, "mixed")).toContain("partly measured");
  });

  it("says out loud what it is assuming", () => {
    expect(objectiveWarning(34, 20, "measured")).toContain("assuming they resolve before the deadline");
  });
});
