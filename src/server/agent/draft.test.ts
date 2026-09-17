import { describe, expect, it } from "vitest";
import { FakeLlm } from "../llm/fake";
import type { LlmCallRecord } from "../llm/structured";
import { DRAFT_PROMPT, checkDraft, draftOutreach, renderDraftInput, type DraftOutput } from "./draft";

const proof = [{ id: "proof_1", title: "Arcaidia", claim: "Designed and built the protocol", url: "https://github.com/immaxkent/arcaidia" }];
const evidenceIds = ["ev_1", "ev_2"];

const draft = (over: Partial<DraftOutput> = {}): DraftOutput => ({
  subject: "Bridge contract before mainnet",
  body: "Your postmortem mentions missing invariant tests. I run fixed-scope pre-audit reviews. Worth a look before 30 October?",
  citations: [{ sentence: "Your postmortem mentions missing invariant tests.", id: "ev_1" }],
  ...over,
});

const guard = { evidenceIds, proof, senderClaimsAllowed: true };

describe("checkDraft", () => {
  it("accepts a draft whose claims cite real evidence", () => {
    expect(checkDraft(draft(), guard)).toMatchObject({ ok: true, violations: [], evidenceCitations: 1 });
  });

  it("refuses a citation to evidence that does not exist", () => {
    const bad = draft({ citations: [{ sentence: "Your postmortem mentions missing invariant tests.", id: "ev_invented" }] });
    const result = checkDraft(bad, guard);
    expect(result.ok).toBe(false);
    expect(result.violations.map((v) => v.code)).toEqual(["citation_unknown_id", "no_evidence_cited"]);
  });

  it("refuses a citation whose sentence is not in the email", () => {
    const bad = draft({ citations: [{ sentence: "You raised a $40m round.", id: "ev_1" }] });
    expect(checkDraft(bad, guard).violations.map((v) => v.code)).toContain("citation_not_in_body");
  });

  it("refuses an email with nothing backed by evidence about this prospect", () => {
    const generic = draft({ body: "I run pre-audit reviews for protocol teams. Worth a look?", citations: [] });
    expect(checkDraft(generic, guard).violations.map((v) => v.code)).toEqual(["no_evidence_cited"]);
  });

  it("refuses sender claims when the operator has no proof", () => {
    const withProofClaim = draft({
      body: "Your postmortem mentions missing invariant tests. I built Arcaidia. Worth a look?",
      citations: [
        { sentence: "Your postmortem mentions missing invariant tests.", id: "ev_1" },
        { sentence: "I built Arcaidia.", id: "proof_1" },
      ],
    });
    expect(checkDraft(withProofClaim, guard).ok).toBe(true);
    const result = checkDraft(withProofClaim, { ...guard, proof: [], senderClaimsAllowed: false });
    expect(result.violations.map((v) => v.code)).toContain("citation_unknown_id");
  });

  it("refuses links the sender's proof does not contain", () => {
    const linked = draft({ body: `${draft().body} See https://example.com/case-study.`, citations: draft().citations });
    expect(checkDraft(linked, guard).violations.map((v) => v.code)).toContain("unsourced_link");
    const allowed = draft({ body: `${draft().body} See https://github.com/immaxkent/arcaidia.`, citations: draft().citations });
    expect(checkDraft(allowed, guard).ok).toBe(true);
  });

  it("ignores whitespace differences between the citation and the body", () => {
    const spaced = draft({ citations: [{ sentence: "Your postmortem   mentions missing invariant tests.", id: "ev_1" }] });
    expect(checkDraft(spaced, guard).ok).toBe(true);
  });
});

describe("renderDraftInput", () => {
  const request = {
    prospect: { company: "Havsledd Labs", person: "Tomas", role: "Lead engineer" },
    segment: { name: "Launch-stage protocols", painHypothesis: "Audits booked out" },
    offering: "Pre-audit security review",
    pricing: "£750 package",
    evidence: [{ id: "ev_1", claim: "Postmortem cites missing invariant tests", sourceRef: "https://havsledd.example/post" }],
    proof,
    senderName: "Max",
    messageClass: "new_outreach" as const,
    history: [],
    today: "2026-09-17",
  };

  it("passes evidence, proof and pricing guidance", () => {
    const text = renderDraftInput(request);
    expect(text).toContain('<item id="ev_1">');
    expect(text).toContain("pricing you may mention: £750 package");
    expect(text).toContain("Arcaidia");
  });

  it("tells the model to claim nothing about the sender when there is no proof", () => {
    expect(renderDraftInput({ ...request, proof: [], pricing: null })).toContain("do not make any claim about the sender");
  });

  it("includes the thread for a follow-up", () => {
    const text = renderDraftInput({ ...request, messageClass: "follow_up", history: [{ direction: "outbound", body: "First note" }] });
    expect(text).toContain("Write a follow-up email");
    expect(text).toContain("First note");
  });
});

describe("draftOutreach", () => {
  const request = {
    prospect: { company: "Havsledd Labs", person: "Tomas", role: "Lead engineer" },
    segment: { name: "Launch-stage protocols", painHypothesis: "Audits booked out" },
    offering: "Pre-audit security review",
    pricing: null,
    evidence: [{ id: "ev_1", claim: "Postmortem cites missing invariant tests", sourceRef: "https://havsledd.example/post" }],
    proof,
    senderName: "Max",
    messageClass: "new_outreach" as const,
    history: [],
    today: "2026-09-17",
  };

  it("returns the draft and the evidence it leans on", async () => {
    const records: LlmCallRecord[] = [];
    const llm = new FakeLlm([draft()]);
    const result = await draftOutreach({ llm, model: "claude-opus-5", record: async (r) => void records.push(r), runId: "run_1" }, request);
    expect(result).toMatchObject({ ok: true, citedEvidenceIds: ["ev_1"] });
    expect(llm.requests[0]).toMatchObject({ system: DRAFT_PROMPT.system, effort: "medium" });
    expect(records[0]).toMatchObject({ role: "outreach.draft", status: "ok" });
  });

  it("reports violations instead of returning an unusable draft as fine", async () => {
    const llm = new FakeLlm([draft({ citations: [{ sentence: "Missing", id: "ev_nope" }] })]);
    const result = await draftOutreach({ llm, model: "claude-opus-5", record: async () => {} }, request);
    expect(result.ok).toBe(false);
    expect(result.citedEvidenceIds).toEqual([]);
  });
});
