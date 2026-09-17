import { describe, expect, it } from "vitest";
import { buildObjectionClusters, buildPerformance, objectionKey, type PerformanceInput } from "./performance";
import type { MessageRow, TriggerRow } from "./rows";
import { T0, messageRow, opportunityRow, prospectRow, segmentRow } from "./testing";

const trigger = (prospectId: string, type: string): TriggerRow => ({
  id: `trg_${prospectId}`,
  prospectId,
  type,
  description: type,
  evidenceId: null,
  detectedAt: T0,
});

const replied = (id: string, prospectId: string, intent: string): MessageRow =>
  messageRow({ id, prospectId, direction: "inbound", messageClass: null, sendState: null, sentAt: null, receivedAt: T0, classification: { intent } });

function input(over: Partial<PerformanceInput> = {}): PerformanceInput {
  return {
    prospects: [
      prospectRow({ id: "p1", segmentId: "seg_launch", stage: "replied", source: "web_research" }),
      prospectRow({ id: "p2", segmentId: "seg_launch", stage: "won", source: "web_research" }),
      prospectRow({ id: "p3", segmentId: "seg_general", stage: "contacted", source: "import" }),
      prospectRow({ id: "p4", segmentId: "seg_general", stage: "contacted", reviewStatus: "rejected", source: "import" }),
    ],
    messages: [
      messageRow({ id: "m1", prospectId: "p1", templateVersion: "v1" }),
      messageRow({ id: "m2", prospectId: "p2", templateVersion: "v1" }),
      messageRow({ id: "m3", prospectId: "p3", templateVersion: "v2" }),
      messageRow({ id: "m4", prospectId: "p4", templateVersion: "v2" }),
      replied("in1", "p1", "question"),
      replied("in2", "p2", "interested"),
      replied("in3", "p3", "not_interested"),
    ],
    opportunities: [opportunityRow({ id: "o1", prospectId: "p2", stage: "won", value: 750 })],
    segments: [segmentRow({ id: "seg_launch", name: "Launch-stage protocols" }), segmentRow({ id: "seg_general", name: "General" })],
    triggers: [trigger("p1", "mainnet_date"), trigger("p2", "mainnet_date"), trigger("p3", "hiring")],
    ...over,
  };
}

const find = (cuts: ReturnType<typeof buildPerformance>, dimension: string, label: string) =>
  cuts.find((c) => c.dimension === dimension && c.label === label)!;

describe("buildPerformance", () => {
  it("counts sends, replies, positive replies, meetings, wins and revenue per segment", () => {
    const cuts = buildPerformance(input());
    expect(find(cuts, "segment", "Launch-stage protocols")).toMatchObject({
      sent: 2,
      replies: 2,
      positiveReplies: 2,
      wins: 1,
      revenue: 750,
    });
    expect(find(cuts, "segment", "General")).toMatchObject({ sent: 1, replies: 1, positiveReplies: 0, wins: 0, revenue: 0 });
  });

  it("ignores rejected prospects", () => {
    const cuts = buildPerformance(input());
    expect(find(cuts, "source", "import").sent).toBe(1);
  });

  it("cuts by trigger, source and message version", () => {
    const cuts = buildPerformance(input());
    expect(find(cuts, "trigger", "mainnet_date")).toMatchObject({ sent: 2, positiveReplies: 2 });
    expect(find(cuts, "source", "web_research")).toMatchObject({ sent: 2, wins: 1 });
    expect(find(cuts, "message_version", "v1")).toMatchObject({ sent: 2, replies: 2 });
    // A message sent to someone later rejected was still sent: the version cut counts it.
    expect(find(cuts, "message_version", "v2")).toMatchObject({ sent: 2, replies: 1, positiveReplies: 0 });
  });

  it("counts a prospect once however many replies they send", () => {
    const cuts = buildPerformance(
      input({ messages: [...input().messages, replied("in4", "p1", "question"), replied("in5", "p1", "objection")] }),
    );
    expect(find(cuts, "segment", "Launch-stage protocols").replies).toBe(2);
  });

  it("counts only messages that were actually sent", () => {
    const cuts = buildPerformance(
      input({ messages: [messageRow({ id: "draft", prospectId: "p1", sendState: "pending_approval", templateVersion: "v1" })] }),
    );
    expect(find(cuts, "segment", "Launch-stage protocols").sent).toBe(0);
    expect(cuts.find((c) => c.dimension === "message_version")).toBeUndefined();
  });

  it("returns nothing when there is nothing to report", () => {
    expect(buildPerformance({ prospects: [], messages: [], opportunities: [], segments: [], triggers: [] })).toEqual([]);
  });
});

describe("objection clusters", () => {
  it("groups wordings of the same objection and keeps the first as the example", () => {
    const clusters = buildObjectionClusters([
      messageRow({ id: "a", classification: { objections: ["We already have an auditor lined up"] } }),
      messageRow({ id: "b", classification: { objections: ["We have an auditor already lined up."] } }),
      messageRow({ id: "c", classification: { objections: ["Too expensive for us right now"] } }),
    ]);
    expect(clusters).toHaveLength(2);
    expect(clusters[0]).toMatchObject({ count: 2, label: "We already have an auditor lined up" });
    expect(clusters[1]).toMatchObject({ count: 1 });
  });

  it("ignores messages without objections and blank entries", () => {
    expect(buildObjectionClusters([messageRow({ id: "a" }), messageRow({ id: "b", classification: { objections: ["  ", 7] } })])).toEqual([]);
  });

  it("builds a stable key regardless of word order and punctuation", () => {
    expect(objectionKey("Too expensive, right now!")).toBe(objectionKey("right now too expensive"));
  });
});
