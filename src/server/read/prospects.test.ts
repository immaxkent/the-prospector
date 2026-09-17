import { describe, expect, it } from "vitest";
import { buildProspect, evidenceItem, type ProspectLookups } from "./prospects";
import {
  T0,
  companyRow,
  evidenceRow,
  messageRow,
  opportunityRow,
  personRow,
  prospectRow,
  segmentRow,
} from "./testing";

function lookups(o: Partial<ProspectLookups> = {}): ProspectLookups {
  return {
    companies: new Map([["com_1", companyRow()]]),
    people: new Map([["per_1", personRow()]]),
    segments: new Map([["seg_1", segmentRow()]]),
    evidence: [],
    triggers: [],
    messages: [],
    opportunities: [],
    ...o,
  };
}

describe("evidenceItem", () => {
  it("labels web sources by hostname and keeps the url", () => {
    expect(evidenceItem(evidenceRow({ sourceRef: "https://www.example.com/a" }))).toMatchObject({
      id: "ev_1",
      source: "example.com",
      url: "https://www.example.com/a",
    });
  });

  it("labels non-web sources without a url", () => {
    const item = evidenceItem(evidenceRow({ sourceType: "manual", sourceRef: "note" }));
    expect(item.source).toBe("Manual note");
    expect(item).not.toHaveProperty("url");
  });
});

describe("buildProspect", () => {
  it("joins person, company, segment and scores", () => {
    const p = buildProspect(
      prospectRow({
        scoreFactors: [
          { factor: "trigger_strength", score: 9, weight: 0.3, note: "Mainnet date", evidenceIds: ["ev_1"] },
          { factor: "timing", score: 4, weight: 0.1, note: "Unclear", evidenceIds: [] },
        ],
      }),
      lookups(),
    );
    expect(p).toMatchObject({
      person: "Ilse Vermeer",
      role: "CTO",
      company: "Northbridge",
      segment: "Launch-stage protocols",
      status: "QUALIFIED",
      fitFactors: ["Trigger strength"],
    });
    expect(p.scoreFactors[0]).toEqual({ label: "Trigger strength", weight: 27, note: "Mainnet date", evidenceIds: ["ev_1"] });
  });

  it("collects evidence for the prospect, its company and its person, newest first", () => {
    const p = buildProspect(
      prospectRow(),
      lookups({
        evidence: [
          evidenceRow({ id: "old", entityType: "company", entityId: "com_1", capturedAt: new Date("2026-09-01") }),
          evidenceRow({ id: "new", entityType: "person", entityId: "per_1", capturedAt: new Date("2026-09-10") }),
          evidenceRow({ id: "other", entityId: "pro_other" }),
        ],
      }),
    );
    expect(p.evidence.map((e) => e.id)).toEqual(["new", "old"]);
  });

  it("reports last touch, open opportunity value and rejection", () => {
    const p = buildProspect(
      prospectRow({ reviewStatus: "rejected", rejectionReason: "Policy conflict" }),
      lookups({
        messages: [
          messageRow({ sentAt: new Date("2026-09-10T00:00:00Z") }),
          messageRow({ id: "in", direction: "inbound", sentAt: null, receivedAt: T0 }),
        ],
        opportunities: [opportunityRow({ stage: "won", value: 1 }), opportunityRow({ id: "open", value: 750 })],
      }),
    );
    expect(p).toMatchObject({
      stage: "rejected",
      status: "REJECTED",
      lastTouch: T0.toISOString(),
      opportunityValue: 750,
      nextAction: "Rejected: Policy conflict",
    });
  });

  it("never invents a contact or company", () => {
    const p = buildProspect(prospectRow({ personId: null, companyId: null, segmentId: null }), lookups());
    expect([p.person, p.company, p.segment]).toEqual(["Unknown contact", "Unknown company", ""]);
  });
});
