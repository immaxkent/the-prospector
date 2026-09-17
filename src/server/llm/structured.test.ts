import { describe, expect, it } from "vitest";
import { z } from "zod/v4";
import { FakeLlm } from "./fake";
import { LlmOutputError, hashInput, runStructured, toApiSchema, type LlmCallRecord } from "./structured";
import { LlmRefusalError } from "./types";

const schema = z.object({ name: z.string().min(1).max(40), tags: z.array(z.string()).min(1) });
const prompt = { role: "test.role", version: "2026-09-17.1", system: "Return a name and tags." };

function setup(responses: unknown[], raw = false) {
  const records: LlmCallRecord[] = [];
  const llm = new FakeLlm(responses, { raw });
  const record = async (r: LlmCallRecord) => {
    records.push(r);
  };
  return { llm, records, run: () => runStructured({ llm, record, prompt, schema, user: "input", model: "claude-opus-5" }) };
}

describe("toApiSchema", () => {
  it("drops keywords structured outputs reject and closes every object", () => {
    const api = toApiSchema(schema) as { properties: Record<string, Record<string, unknown>>; additionalProperties: boolean };
    expect(api.additionalProperties).toBe(false);
    expect(api.properties["name"]).toEqual({ type: "string" });
    expect(api.properties["tags"]).not.toHaveProperty("minItems");
    expect(JSON.stringify(api)).not.toContain("$schema");
  });
});

describe("runStructured", () => {
  it("returns validated output and records spend", async () => {
    const { run, records, llm } = setup([{ name: "Ada", tags: ["x"] }]);
    const { output } = await run();
    expect(output).toEqual({ name: "Ada", tags: ["x"] });
    expect(llm.requests[0]).toMatchObject({ model: "claude-opus-5", system: prompt.system, user: "input", maxTokens: 16000 });
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ role: "test.role", promptVersion: "2026-09-17.1", status: "ok", inputTokens: 1000, outputTokens: 200, costUsd: 0.01 });
  });

  it("rejects output that breaks the schema, including bounds the API was not told about", async () => {
    const { run, records } = setup([{ name: "", tags: [] }]);
    await expect(run()).rejects.toBeInstanceOf(LlmOutputError);
    expect(records[0]!.status).toBe("invalid_output");
  });

  it("rejects non-JSON text", async () => {
    const { run, records } = setup(["not json"], true);
    await expect(run()).rejects.toThrow("does not match its schema");
    expect(records[0]!.status).toBe("invalid_output");
  });

  it("records provider errors and refusals without spend and rethrows", async () => {
    const { run, records } = setup([new LlmRefusalError("cyber")]);
    await expect(run()).rejects.toBeInstanceOf(LlmRefusalError);
    expect(records[0]).toMatchObject({ status: "error", costUsd: 0 });
  });

  it("hashes identical inputs identically", () => {
    expect(hashInput(["a", 1])).toBe(hashInput(["a", 1]));
    expect(hashInput(["a", 1])).not.toBe(hashInput(["a", 2]));
  });
});
