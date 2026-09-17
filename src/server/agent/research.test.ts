import { describe, expect, it } from "vitest";
import { FakeLlm } from "../llm/fake";
import type { LlmCallRecord } from "../llm/structured";
import { RESEARCH_PROMPT } from "./research-prompt";
import { renderResearchInput, researchCandidates, verifyAgainstSources, type Candidate } from "./research";

const candidate = (over: Partial<Candidate> = {}): Candidate => ({
  company: { name: "Northbridge Protocol", domain: "northbridge.example" },
  person: { name: "Ilse Vermeer", role: "CTO" },
  trigger: { type: "mainnet_date", description: "Mainnet announced for 30 October" },
  evidence: [
    { claim: "Mainnet launches 30 October", sourceRef: "https://northbridge.example/blog/mainnet", excerpt: "…30 October…", confidence: 0.9 },
  ],
  ...over,
});

const sources = [{ url: "https://www.northbridge.example/blog/mainnet", title: "Mainnet" }];

const request = {
  segment: { name: "Launch-stage protocols", definition: "Pre-audit teams", signals: ["mainnet date"], painHypothesis: "Audits booked out" },
  offering: "Pre-audit security review",
  exclusions: ["No gambling protocols"],
  knownTargets: ["Northbridge Protocol"],
  wanted: 5,
  today: "2026-09-17",
};

describe("verifyAgainstSources", () => {
  it("keeps evidence from pages search returned, ignoring www and paths", () => {
    const result = verifyAgainstSources([candidate()], sources);
    expect(result.candidates).toHaveLength(1);
    expect(result).toMatchObject({ droppedClaims: 0, droppedCandidates: 0 });
  });

  it("drops claims citing a page that was never opened", () => {
    const invented = candidate({
      evidence: [
        { claim: "Raised $40m", sourceRef: "https://invented.example/press", excerpt: "…", confidence: 0.9 },
        { claim: "Mainnet 30 October", sourceRef: "https://northbridge.example/blog/mainnet", excerpt: "…", confidence: 0.8 },
      ],
    });
    const result = verifyAgainstSources([invented], sources);
    expect(result.droppedClaims).toBe(1);
    expect(result.candidates[0]!.evidence.map((e) => e.claim)).toEqual(["Mainnet 30 October"]);
  });

  it("drops a candidate whose every claim was unverifiable", () => {
    const fabricated = candidate({
      company: { name: "Ghost Labs" },
      evidence: [{ claim: "Ghost Labs is pre-audit", sourceRef: "https://ghost.example/x", excerpt: "…", confidence: 0.5 }],
    });
    const result = verifyAgainstSources([candidate(), fabricated], sources);
    expect(result.candidates.map((c) => c.company.name)).toEqual(["Northbridge Protocol"]);
    expect(result).toMatchObject({ droppedCandidates: 1, droppedClaims: 1 });
  });
});

describe("renderResearchInput", () => {
  it("passes the segment, offer, exclusions and known targets", () => {
    const text = renderResearchInput(request);
    expect(text).toContain("Today is 2026-09-17.");
    expect(text).toContain("Find up to 5 candidate companies");
    expect(text).toContain("No gambling protocols");
    expect(text).toContain("- Northbridge Protocol");
  });
});

describe("researchCandidates", () => {
  function deps(output: unknown, webSources = sources) {
    const records: LlmCallRecord[] = [];
    const llm = new FakeLlm([output], { sources: webSources });
    return { llm, records, deps: { llm, model: "claude-opus-5", record: async (r: LlmCallRecord) => void records.push(r), runId: "run_1" } };
  }

  it("asks with web search and reports what survived verification", async () => {
    const { deps: d, llm, records } = deps({ candidates: [candidate()], searchNotes: "searched mainnet announcements" });
    const result = await researchCandidates(d, request);
    expect(result).toMatchObject({ proposed: 1, droppedClaims: 0, droppedCandidates: 0, searchNotes: "searched mainnet announcements" });
    expect(result.candidates).toHaveLength(1);
    expect(llm.requests[0]).toMatchObject({ system: RESEARCH_PROMPT.system, webSearch: { maxUses: 8 }, effort: "high" });
    expect(records[0]).toMatchObject({ role: "research.discover", runId: "run_1", status: "ok" });
  });

  it("returns nothing when every candidate was unverifiable", async () => {
    const { deps: d } = deps({ candidates: [candidate()], searchNotes: "no usable sources" }, []);
    const result = await researchCandidates(d, request);
    expect(result.candidates).toEqual([]);
    expect(result.droppedCandidates).toBe(1);
  });
});
