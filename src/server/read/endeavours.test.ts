import { describe, expect, it } from "vitest";
import { fixtureSpec } from "../db/fixtures";
import { buildEndeavour, healthFor, objectiveText, type EndeavourInputs } from "./endeavours";
import { T0, approvalRow, endeavourRow, messageRow, opportunityRow, prospectRow, runRow } from "./testing";

function inputs(o: Partial<EndeavourInputs> = {}): EndeavourInputs {
  return {
    endeavour: endeavourRow(),
    prospects: [],
    opportunities: [],
    messages: [],
    approvals: [],
    runs: [],
    insights: [],
    now: T0,
    ...o,
  };
}

describe("objectiveText", () => {
  it("describes revenue and count objectives", () => {
    expect(objectiveText(fixtureSpec("m"))).toBe("Generate £3,000 in revenue");
    const spec = fixtureSpec("m");
    spec.objective = { state: "confirmed", value: { metric: "users", target: 1500, unit: "signups" } };
    expect(objectiveText(spec)).toBe("Reach 1,500 signups");
    spec.objective = { state: "missing" };
    expect(objectiveText(spec)).toBe("Objective not set");
  });
});

describe("healthFor", () => {
  it("compares progress with elapsed time", () => {
    expect(healthFor("active", 0.5, 0.4)).toBe("ON_TRACK");
    expect(healthFor("active", 0.3, 0.4)).toBe("AT_RISK");
    expect(healthFor("active", 0.1, 0.4)).toBe("BEHIND");
    expect(healthFor("active", 0, 0)).toBe("ON_TRACK");
    expect(healthFor("paused", 1, 0.1)).toBe("PAUSED");
  });
});

describe("buildEndeavour", () => {
  it("maps identity, cadence, mailbox and strategy from the spec", () => {
    const e = buildEndeavour(inputs());
    expect(e).toMatchObject({
      id: "end_1",
      kind: "sprint",
      mailboxId: "mbx_1",
      unit: "GBP",
      targetValue: 3000,
      deadline: "2026-11-16",
      horizonDays: 61,
      period: null,
      autonomy: "DRAFT",
      channels: ["EMAIL"],
      quota: { newProspects: 10, outreach: 10, followups: 8 },
      strategy: { offer: "Fixed-scope pre-audit security review", hypothesis: "" },
    });
  });

  it("counts won revenue as actual and open opportunities as pipeline", () => {
    const e = buildEndeavour(
      inputs({
        opportunities: [
          opportunityRow({ id: "a", stage: "won", value: 750 }),
          opportunityRow({ id: "b", stage: "proposal", value: 1200 }),
          opportunityRow({ id: "c", stage: "lost", value: 900 }),
        ],
      }),
    );
    expect([e.actualValue, e.pipelineValue]).toEqual([750, 1200]);
  });

  it("builds a cumulative funnel that ignores rejected prospects", () => {
    const e = buildEndeavour(
      inputs({
        prospects: [
          prospectRow({ id: "1", stage: "discovered" }),
          prospectRow({ id: "2", stage: "contacted" }),
          prospectRow({ id: "3", stage: "meeting" }),
          prospectRow({ id: "4", stage: "lost" }),
          prospectRow({ id: "5", stage: "qualified", reviewStatus: "rejected" }),
        ],
      }),
    );
    expect(e.funnel).toMatchObject({ discovered: 3, researched: 2, contacted: 2, replied: 1, meeting: 1, won: 0, lost: 1 });
  });

  it("counts today's quota work in the operator's day", () => {
    const e = buildEndeavour(
      inputs({
        now: new Date("2026-09-17T20:00:00Z"),
        messages: [
          messageRow({ id: "1", messageClass: "new_outreach", sentAt: new Date("2026-09-17T09:00:00Z") }),
          messageRow({ id: "2", messageClass: "follow_up", sentAt: new Date("2026-09-17T10:00:00Z") }),
          messageRow({ id: "3", messageClass: "new_outreach", sentAt: new Date("2026-09-16T10:00:00Z") }),
          messageRow({ id: "4", direction: "inbound", messageClass: null, sentAt: null, receivedAt: new Date("2026-09-17T11:00:00Z") }),
        ],
      }),
    );
    expect(e.quotaDone).toMatchObject({ outreach: 1, followups: 1 });
    expect(e.repliesToday).toBe(1);
  });

  it("puts pending approvals ahead of due prospect actions", () => {
    const prospects = [prospectRow({ nextAction: "Follow up", nextActionAt: T0 })];
    expect(buildEndeavour(inputs({ prospects })).nextCriticalAction).toBe("Follow up");
    expect(
      buildEndeavour(inputs({ prospects, approvals: [approvalRow({ kind: "reply_approval" })] })).nextCriticalAction,
    ).toBe("Approval waiting: reply approval");
    expect(buildEndeavour(inputs()).nextCriticalAction).toBe("No action due");
  });

  it("reports the latest run and pauses health for paused endeavours", () => {
    const e = buildEndeavour(
      inputs({
        endeavour: endeavourRow({ status: "paused" }),
        runs: [runRow({ id: "old", startedAt: new Date("2026-09-16T08:00:00Z") }), runRow({ id: "new" })],
      }),
    );
    expect(e.lastRunAt).toBe(T0.toISOString());
    expect(e.health).toBe("PAUSED");
  });

  it("uses the current period end for ongoing endeavours", () => {
    const spec = fixtureSpec("mbx_1");
    spec.kind = "ongoing";
    spec.horizon = { state: "confirmed", value: { kind: "ongoing", period: "week", reviewEvery: 4 } };
    const e = buildEndeavour(
      inputs({ endeavour: endeavourRow({ kind: "ongoing", spec }), now: new Date("2026-09-25T12:00:00Z") }),
    );
    expect(e).toMatchObject({ period: "week", horizonDays: 7, deadline: "2026-10-01" });
  });
});
