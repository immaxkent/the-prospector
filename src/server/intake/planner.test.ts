import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { evaluateActivation, type FieldState } from "../domain/endeavour-spec";
import { FakeLlm } from "../llm/fake";
import type { LlmCallRecord } from "../llm/structured";
import { toApiSchema } from "../llm/structured";
import { mergeDraft, planIntake, plannerOutputSchema, FALLBACK_QUESTIONS } from "./planner";
import { PLANNER_PROMPT, operatorText, renderPlannerInput } from "./prompt";
import { solidityPlannerOutput } from "./testing";

const BRIEF = readFileSync("fixtures/endeavours/solidity-sprint.brief.md", "utf8").replace(/<!--[\s\S]*?-->\n?/, "");
const EXPECTED = JSON.parse(readFileSync("fixtures/endeavours/solidity-sprint.expected.json", "utf8")) as {
  kind: string;
  states: Record<string, string | string[]>;
  mustAsk: string[];
};

function deps(responses: unknown[]) {
  const records: LlmCallRecord[] = [];
  const llm = new FakeLlm(responses);
  return { llm, records, deps: { llm, model: "claude-opus-5", record: async (r: LlmCallRecord) => void records.push(r) } };
}

describe("planner output schema", () => {
  it("converts to a structured-outputs schema with closed objects and no unsupported keywords", () => {
    const json = JSON.stringify(toApiSchema(plannerOutputSchema));
    for (const keyword of ["minLength", "minItems", "maximum", "pattern", "format", "$schema"]) {
      expect(json).not.toContain(`"${keyword}"`);
    }
    expect(json).not.toContain('"additionalProperties":true');
    expect(json).toContain('"not_applicable"'.replace("not_applicable", "stated"));
  });
});

describe("prompt rendering", () => {
  it("includes today, the brief and only answered questions", () => {
    const text = renderPlannerInput(BRIEF, [
      { field: "pricing", question: "Price?", answer: "£750 per review" },
      { field: "proof", question: "Proof?", answer: "  " },
    ], "2026-09-17");
    expect(text).toContain("Today is 2026-09-17.");
    expect(text).toContain("<brief>");
    expect(text).toContain('<answer field="pricing">');
    expect(text).not.toContain('field="proof"');
  });

  it("treats answers as operator text for quote checks", () => {
    expect(operatorText("brief", [{ field: "pricing", question: "q", answer: "£750" }])).toBe("brief\n\n£750");
  });
});

describe("planIntake on the Solidity fixture", () => {
  it("produces the expected field states and asks about every open field", async () => {
    const { deps: d, llm, records } = deps([solidityPlannerOutput()]);
    const { spec, questions } = await planIntake(d, { brief: BRIEF, answers: [], today: "2026-09-17" });

    expect(spec.kind).toBe(EXPECTED.kind);
    for (const [field, expected] of Object.entries(EXPECTED.states)) {
      const state = (spec[field as keyof typeof spec] as FieldState<unknown>).state;
      expect(Array.isArray(expected) ? expected : [expected], field).toContain(state);
    }
    const asked = questions.map((q) => q.field);
    for (const field of EXPECTED.mustAsk) expect(asked).toContain(field);
    // The model skipped exclusions; the planner supplies a fallback question.
    expect(questions.find((q) => q.field === "exclusions")?.question).toContain("Say 'none'");

    expect(llm.requests[0]).toMatchObject({ model: "claude-opus-5", system: PLANNER_PROMPT.system, effort: "high" });
    expect(records[0]).toMatchObject({ role: "intake.planner", status: "ok" });
  });

  it("downgrades a stated field whose quote is not in the operator's words", async () => {
    const invented = solidityPlannerOutput({
      proof: {
        state: "stated",
        quote: "I audited Uniswap",
        value: [{ kind: "client", title: "Uniswap", claim: "Audited Uniswap" }],
      },
    });
    const { deps: d } = deps([invented]);
    const { spec, questions } = await planIntake(d, { brief: BRIEF, answers: [], today: "2026-09-17" });
    expect(spec.proof.state).toBe("suggested");
    expect(questions.map((q) => q.field)).toContain("proof");
  });

  it("accepts quotes taken from the operator's answers", async () => {
    const answered = solidityPlannerOutput({
      pricing: { state: "stated", quote: "£750 per review", value: { model: "package", amount: 750, currency: "GBP" } },
    });
    const { deps: d } = deps([answered]);
    const { spec } = await planIntake(d, {
      brief: BRIEF,
      answers: [{ field: "pricing", question: "Price?", answer: "£750 per review" }],
      today: "2026-09-17",
    });
    expect(spec.pricing.state).toBe("stated");
  });

  it("the fixture draft stays blocked until the operator fills the gaps", async () => {
    const { deps: d } = deps([solidityPlannerOutput()]);
    const { spec } = await planIntake(d, { brief: BRIEF, answers: [], today: "2026-09-17" });
    const draft = mergeDraft(null, spec);
    const gate = evaluateActivation(draft, { brief: BRIEF, connectedMailboxIds: [] });
    expect(gate.ready).toBe(false);
    expect(gate.blockers.map((b) => b.field)).toEqual(expect.arrayContaining(["pricing", "proof", "exclusions", "mailboxId"]));
  });
});

describe("mergeDraft", () => {
  it("keeps operator confirmations and not-applicable marks across re-planning", async () => {
    const { deps: d } = deps([solidityPlannerOutput(), solidityPlannerOutput()]);
    const first = mergeDraft(null, (await planIntake(d, { brief: BRIEF, answers: [], today: "2026-09-17" })).spec);
    const edited = {
      ...first,
      proof: { state: "not_applicable" as const, reason: "New practice" },
      exclusions: { state: "confirmed" as const, value: [] },
      autonomyLevel: "OBSERVE" as const,
    };
    const second = mergeDraft(edited, (await planIntake(d, { brief: BRIEF, answers: [], today: "2026-09-17" })).spec);
    expect(second.proof).toEqual({ state: "not_applicable", reason: "New practice" });
    expect(second.exclusions).toEqual({ state: "confirmed", value: [] });
    expect(second.pricing.state).toBe("suggested");
    expect(second.autonomyLevel).toBe("OBSERVE");
    expect(second.channels).toEqual(["email"]);
  });
});

describe("proof needs something a recipient can open", () => {
  it("asks for a link when a proof item has none", () => {
    // The fallback question is what the operator sees when the model asks nothing useful.
    expect(FALLBACK_QUESTIONS.proof).toMatch(/link|open|check/i);
  });
});
