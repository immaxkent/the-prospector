import { describe, expect, it } from "vitest";
import { FakeLlm } from "../llm/fake";
import type { LlmCallRecord } from "../llm/structured";
import { QUALIFY_PROMPT } from "./research-prompt";
import {
  FACTOR_WEIGHTS,
  QUALIFICATION_FACTORS,
  qualifyProspect,
  renderQualifyInput,
  scoreQualification,
  type QualifyOutput,
} from "./qualify";

const evidenceIds = ["ev_1", "ev_2"];

const output = (over: Partial<QualifyOutput> = {}): QualifyOutput => ({
  factors: QUALIFICATION_FACTORS.map((factor) => ({ factor, score: 8, note: `${factor} looks good`, evidenceIds: ["ev_1"] })),
  recommendation: "qualify",
  reason: "Pre-audit team with a published mainnet date",
  ...over,
});

const request = {
  segment: { name: "Launch-stage protocols", definition: "Pre-audit teams", signals: ["mainnet date"], painHypothesis: "Audits booked out" },
  offering: "Pre-audit security review",
  exclusions: ["No gambling protocols"],
  prospect: { company: "Northbridge", person: "Ilse Vermeer", role: "CTO", hasEmail: true, trigger: "Mainnet on 30 October" },
  evidence: [
    { id: "ev_1", claim: "Mainnet 30 October", sourceRef: "https://northbridge.example/blog", capturedAt: "2026-09-16", confidence: 0.9 },
    { id: "ev_2", claim: "No audit listed", sourceRef: "https://northbridge.example/security", capturedAt: "2026-09-16", confidence: 0.6 },
  ],
  today: "2026-09-17",
};

describe("weights", () => {
  it("cover every factor and sum to one", () => {
    expect(Object.keys(FACTOR_WEIGHTS).sort()).toEqual([...QUALIFICATION_FACTORS].sort());
    expect(Object.values(FACTOR_WEIGHTS).reduce((a, b) => a + b, 0)).toBeCloseTo(1);
  });
});

describe("scoreQualification", () => {
  it("computes the weighted score and keeps every factor", () => {
    const result = scoreQualification(output(), evidenceIds);
    expect(result.score).toBe(80);
    expect(result.factors).toHaveLength(QUALIFICATION_FACTORS.length);
    expect(result.outcome).toBe("qualified");
  });

  it("counts missing factors as zero instead of ignoring them", () => {
    const partial = output({ factors: [{ factor: "icp_fit", score: 10, note: "Exact fit", evidenceIds: ["ev_1"] }] });
    const result = scoreQualification(partial, evidenceIds);
    expect(result.score).toBe(20);
    expect(result.outcome).toBe("rejected");
    expect(result.factors.find((f) => f.factor === "timing")).toMatchObject({ score: 0, note: "Not assessed" });
  });

  it("drops citations to evidence that does not exist", () => {
    const invented = output({
      factors: [{ factor: "icp_fit", score: 9, note: "Fits", evidenceIds: ["ev_1", "ev_invented"] }],
    });
    const result = scoreQualification(invented, evidenceIds);
    expect(result.droppedCitations).toBe(1);
    expect(result.factors[0]!.evidenceIds).toEqual(["ev_1"]);
  });

  it("respects a reject recommendation however high the score", () => {
    expect(scoreQualification(output({ recommendation: "reject" }), evidenceIds)).toMatchObject({ score: 80, outcome: "rejected" });
  });

  it("sends an uncertain or middling prospect to review", () => {
    expect(scoreQualification(output({ recommendation: "review" }), evidenceIds).outcome).toBe("needs_review");
    const middling = output({ factors: QUALIFICATION_FACTORS.map((factor) => ({ factor, score: 5, note: "Unclear", evidenceIds: [] })) });
    expect(scoreQualification(middling, evidenceIds)).toMatchObject({ score: 50, outcome: "needs_review" });
  });
});

describe("renderQualifyInput", () => {
  it("passes the prospect, exclusions and every evidence id", () => {
    const text = renderQualifyInput(request);
    expect(text).toContain('<item id="ev_1"');
    expect(text).toContain("reachable by email: yes");
    expect(text).toContain("No gambling protocols");
  });
});

describe("qualifyProspect", () => {
  it("scores through the model and records the call", async () => {
    const records: LlmCallRecord[] = [];
    const llm = new FakeLlm([output()]);
    const result = await qualifyProspect(
      { llm, model: "claude-opus-5", record: async (r) => void records.push(r), runId: "run_1" },
      request,
    );
    expect(result).toMatchObject({ score: 80, outcome: "qualified" });
    expect(llm.requests[0]).toMatchObject({ system: QUALIFY_PROMPT.system, effort: "medium" });
    expect(llm.requests[0]!.webSearch).toBeUndefined();
    expect(records[0]).toMatchObject({ role: "research.qualify", status: "ok", runId: "run_1" });
  });
});
