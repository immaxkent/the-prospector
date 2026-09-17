import { describe, expect, it } from "vitest";
import { buildApproval, type ApprovalLookups } from "./approvals";
import { T0, approvalRow, evidenceRow, messageRow, opportunityRow, personRow, prospectRow, threadRow } from "./testing";

function lookups(o: Partial<ApprovalLookups> = {}): ApprovalLookups {
  return {
    messages: new Map([["msg_1", messageRow({ body: "Draft copy", evidenceIds: ["ev_1", "missing"], sendState: "pending_approval" })]]),
    threads: new Map([["thr_1", threadRow()]]),
    prospects: new Map([["pro_1", prospectRow()]]),
    people: new Map([["per_1", personRow()]]),
    opportunities: [opportunityRow({ value: 1200 })],
    evidence: new Map([["ev_1", evidenceRow()]]),
    ...o,
  };
}

describe("buildApproval", () => {
  it("shows an outreach draft with its recipient, copy, value and cited evidence", () => {
    const a = buildApproval(approvalRow({ payload: { why: "Mainnet in 6 weeks" } }), lookups());
    expect(a).toMatchObject({
      kind: "OUTREACH_DRAFT",
      title: "New outreach ready to send",
      recipient: "Ilse Vermeer <ilse@northbridge.example>",
      why: "Mainnet in 6 weeks",
      copy: "Draft copy",
      value: 1200,
      createdAt: T0.toISOString(),
    });
    expect(a.evidence.map((e) => e.id)).toEqual(["ev_1"]);
  });

  it("resolves thread subjects and uses the payload draft", () => {
    const a = buildApproval(
      approvalRow({ kind: "reply_approval", subjectType: "thread", subjectId: "thr_1", payload: { draft: "Yes, Friday works", evidenceIds: ["ev_1"] } }),
      lookups(),
    );
    expect(a).toMatchObject({ kind: "REPLY_APPROVAL", copy: "Yes, Friday works", recipient: "Ilse Vermeer <ilse@northbridge.example>" });
    expect(a.evidence).toHaveLength(1);
  });

  it("handles approvals without a prospect", () => {
    const a = buildApproval(
      approvalRow({ kind: "failed_run", subjectType: "run", subjectId: "run_1", payload: { why: "Search provider timed out", title: "Run failed at research" } }),
      lookups(),
    );
    expect(a).toMatchObject({ kind: "FAILED_RUN", title: "Run failed at research", recipient: "—", value: null, copy: "", evidence: [] });
  });
});
