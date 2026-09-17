import { describe, expect, it } from "vitest";
import { agentState, buildActivity, buildInsight, buildRun, buildRunLog } from "./activity";
import type { EventRow, InsightRow } from "./rows";
import { T0, runRow } from "./testing";

const event = (o: Partial<EventRow>): EventRow => ({
  id: "evt_1",
  sourceSystem: "prospector",
  eventType: "message.sent",
  entityType: "message",
  entityId: "msg_1",
  payload: {},
  schemaVersion: 1,
  occurredAt: T0,
  seq: 1,
  ...o,
});

const insight = (o: Partial<InsightRow>): InsightRow => ({
  id: "ins_1",
  endeavourId: "end_1",
  type: "observation",
  statement: "Launch-stage protocols reply more",
  evidence: { summary: "5/22 vs 1/41" },
  confidence: 0.7,
  status: "open",
  createdAt: T0,
  updatedAt: T0,
  ...o,
});

describe("runs", () => {
  it("maps status, metrics and duration, using now for running runs", () => {
    expect(buildRun(runRow({ metrics: { discovered: 14, sent: 3 } }), T0)).toMatchObject({
      state: "OK",
      durationMs: 90_000,
      discovered: 14,
      qualified: 0,
      sent: 3,
    });
    const running = buildRun(runRow({ status: "running", finishedAt: null }), new Date(T0.getTime() + 5000));
    expect(running).toMatchObject({ state: "RUNNING", durationMs: 5000 });
    expect(buildRun(runRow({ status: "interrupted" }), T0).state).toBe("FAILED");
  });

  it("orders log lines oldest first", () => {
    const lines = buildRunLog([
      { id: "b", runId: "r", level: "warn", text: "second", at: new Date(T0.getTime() + 1) },
      { id: "a", runId: "r", level: "info", text: "first", at: T0 },
    ]);
    expect(lines.map((l) => [l.id, l.level])).toEqual([["a", "INFO"], ["b", "WARN"]]);
  });
});

describe("buildActivity", () => {
  it("keeps known events, newest first, with payload subject and detail", () => {
    const events = [
      event({ id: "old", occurredAt: new Date("2026-09-16") }),
      event({ id: "new", eventType: "message.received", payload: { endeavourId: "end_1", subject: "Northbridge", detail: "Asked for pricing" } }),
      event({ id: "unknown", eventType: "product.capability.changed" }),
    ];
    expect(buildActivity(events)).toEqual([
      { id: "new", at: T0.toISOString(), kind: "REPLY_RECEIVED", endeavourId: "end_1", subject: "Northbridge", detail: "Asked for pricing" },
      { id: "old", at: "2026-09-16T00:00:00.000Z", kind: "SENT", endeavourId: "", subject: "msg_1", detail: "" },
    ]);
  });

  it("limits the feed", () => {
    const events = Array.from({ length: 5 }, (_, i) => event({ id: String(i) }));
    expect(buildActivity(events, 2)).toHaveLength(2);
  });
});

describe("buildInsight", () => {
  it("shows the evidence summary and hides dismissed insights", () => {
    expect(buildInsight(insight({ type: "recommendation" }))).toMatchObject({ type: "RECOMMENDATION", evidence: "5/22 vs 1/41" });
    expect(buildInsight(insight({ type: "objection", evidence: { count: 3 } }))).toMatchObject({ type: "OBSERVATION", evidence: '{"count":3}' });
    expect(buildInsight(insight({ status: "dismissed" }))).toBeNull();
  });
});

describe("agentState", () => {
  it("reports running, error, online or waiting", () => {
    expect(agentState([runRow({ status: "running" })], 1)).toBe("RUNNING");
    expect(agentState([runRow({ status: "failed" }), runRow({ id: "old", startedAt: new Date("2026-09-01") })], 1)).toBe("ERROR");
    expect(agentState([runRow()], 1)).toBe("ONLINE");
    expect(agentState([], 0)).toBe("WAITING");
  });
});
