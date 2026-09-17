import { describe, expect, it } from "vitest";
import { buildOpportunity, buildSegmentPerformance } from "./pipeline";
import { companyRow, messageRow, opportunityRow, prospectRow, segmentRow } from "./testing";

describe("buildOpportunity", () => {
  const prospects = new Map([["pro_1", prospectRow({ nextAction: "Send proposal" })]]);
  const companies = new Map([["com_1", companyRow()]]);

  it("joins company and next action and falls back to the stage probability", () => {
    expect(buildOpportunity(opportunityRow(), prospects, companies)).toMatchObject({
      company: "Northbridge",
      probability: 0.6,
      nextAction: "Send proposal",
    });
  });

  it("prefers the user's probability", () => {
    expect(buildOpportunity(opportunityRow({ probabilityUserDefined: 0.9 }), prospects, companies).probability).toBe(0.9);
    expect(buildOpportunity(opportunityRow({ prospectId: null }), prospects, companies).company).toBe("—");
  });
});

describe("buildSegmentPerformance", () => {
  it("counts sends, replying prospects, meetings and wins per segment", () => {
    const prospects = [
      prospectRow({ id: "a", stage: "meeting" }),
      prospectRow({ id: "b", stage: "won" }),
      prospectRow({ id: "c", stage: "contacted", reviewStatus: "rejected" }),
      prospectRow({ id: "d", segmentId: "seg_2" }),
    ];
    const messages = [
      messageRow({ id: "1", prospectId: "a" }),
      messageRow({ id: "2", prospectId: "b" }),
      messageRow({ id: "3", prospectId: "b", sendState: "pending_approval" }),
      messageRow({ id: "4", prospectId: "a", direction: "inbound", messageClass: null, sendState: null }),
      messageRow({ id: "5", prospectId: "a", direction: "inbound", messageClass: null, sendState: null }),
      messageRow({ id: "6", prospectId: "c" }),
    ];
    expect(buildSegmentPerformance([segmentRow()], prospects, messages)).toEqual([
      { segment: "Launch-stage protocols", sent: 2, replies: 1, meetings: 2, wins: 1 },
    ]);
  });
});
