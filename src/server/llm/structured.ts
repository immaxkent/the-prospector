/**
 * Runs one agent role: renders a versioned prompt, asks for schema-shaped JSON,
 * validates it locally, and records the call. Invalid output fails safely and is never used.
 */
import { createHash } from "node:crypto";
import { z } from "zod/v4";
import { newId } from "../ids";
import { BudgetExceededError } from "./budgeted";
import { costUsd } from "./pricing";
import type { Effort, LlmClient, LlmResponse } from "./types";

export interface PromptDefinition {
  /** Stable role name, e.g. "intake.planner". */
  role: string;
  /** Bumped whenever the system prompt or schema changes. */
  version: string;
  system: string;
}

export interface LlmCallRecord {
  id: string;
  runId: string | null;
  role: string;
  promptVersion: string;
  model: string;
  inputHash: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  status: "ok" | "invalid_output" | "error";
}

export type CallRecorder = (record: LlmCallRecord) => Promise<void>;

export class LlmOutputError extends Error {
  constructor(
    readonly role: string,
    readonly issues: string,
  ) {
    super(`${role} returned output that does not match its schema`);
  }
}

// Structured outputs accept a subset of JSON Schema. Bounds are enforced by the local zod parse instead.
const UNSUPPORTED = new Set(["minLength", "maxLength", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "minItems", "maxItems", "pattern", "format", "$schema"]);

export function toApiSchema(schema: z.ZodType): Record<string, unknown> {
  const strip = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(strip);
    if (!node || typeof node !== "object") return node;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node)) {
      if (!UNSUPPORTED.has(k)) out[k] = strip(v);
    }
    if (out["type"] === "object") out["additionalProperties"] = false;
    return out;
  };
  return strip(z.toJSONSchema(schema, { io: "output" })) as Record<string, unknown>;
}

export function hashInput(parts: unknown[]) {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

export interface StructuredCall<S extends z.ZodType> {
  llm: LlmClient;
  record: CallRecorder;
  prompt: PromptDefinition;
  schema: S;
  user: string;
  model: string;
  maxTokens?: number;
  effort?: Effort;
  webSearch?: { maxUses: number };
  runId?: string | null;
}

export async function runStructured<S extends z.ZodType>(call: StructuredCall<S>): Promise<{ output: z.infer<S>; response: LlmResponse }> {
  const jsonSchema = toApiSchema(call.schema);
  const base = {
    id: newId("llmCall"),
    runId: call.runId ?? null,
    role: call.prompt.role,
    promptVersion: call.prompt.version,
    inputHash: hashInput([call.prompt.system, call.user, jsonSchema, call.model]),
  };

  let response: LlmResponse;
  try {
    response = await call.llm.complete({
      model: call.model,
      system: call.prompt.system,
      user: call.user,
      jsonSchema,
      maxTokens: call.maxTokens ?? 16_000,
      effort: call.effort,
      webSearch: call.webSearch,
    });
  } catch (err) {
    // A call refused for budget never reached the model, so it is not one of its calls.
    if (err instanceof BudgetExceededError) throw err;
    await call.record({ ...base, model: call.model, inputTokens: 0, outputTokens: 0, costUsd: 0, status: "error" });
    throw err;
  }

  const spend = {
    model: response.model,
    inputTokens: response.usage.inputTokens + response.usage.cacheCreationInputTokens + response.usage.cacheReadInputTokens,
    outputTokens: response.usage.outputTokens,
    costUsd: costUsd(response.model, response.usage),
  };

  let parsed: unknown;
  try {
    parsed = JSON.parse(response.text);
  } catch {
    await call.record({ ...base, ...spend, status: "invalid_output" });
    throw new LlmOutputError(call.prompt.role, "response was not JSON");
  }
  const result = call.schema.safeParse(parsed);
  if (!result.success) {
    await call.record({ ...base, ...spend, status: "invalid_output" });
    throw new LlmOutputError(call.prompt.role, z.prettifyError(result.error));
  }
  await call.record({ ...base, ...spend, status: "ok" });
  return { output: result.data, response };
}
