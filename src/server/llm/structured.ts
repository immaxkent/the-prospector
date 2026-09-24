/**
 * Runs one agent role: renders a versioned prompt, asks for schema-shaped JSON,
 * validates it locally, and records the call. Invalid output fails safely and is never used.
 */
import { createHash } from "node:crypto";
import { z } from "zod/v4";
import { newId } from "../ids";
import { BatchTimeoutError, type BatchLlmClient, type BatchOutcome } from "./batch";
import { BudgetExceededError } from "./budgeted";
import { costUsd } from "./pricing";
import type { Depth, Effort, LlmClient, LlmRequest, LlmResponse } from "./types";

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
  /** Present when the call failed: the provider's own words, trimmed. */
  error?: string | null;
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
  /** How much deliberation this role needs; defaults to deep when unstated. */
  depth?: Depth;
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
      depth: call.depth,
    });
  } catch (err) {
    // A call refused for budget never reached the model, so it is not one of its calls.
    if (err instanceof BudgetExceededError) throw err;
    const reason = err instanceof Error ? err.message : String(err);
    // Recorded and logged: a provider's refusal is the most useful thing it ever says.
    console.error(`llm call ${base.role} failed: ${reason}`);
    await call.record({ ...base, model: call.model, inputTokens: 0, outputTokens: 0, costUsd: 0, status: "error", error: reason.slice(0, 2000) });
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
    await call.record({ ...base, ...spend, status: "invalid_output", error: "the response was not JSON" });
    throw new LlmOutputError(call.prompt.role, "response was not JSON");
  }
  const result = call.schema.safeParse(parsed);
  if (!result.success) {
    const issues = z.prettifyError(result.error);
    await call.record({ ...base, ...spend, status: "invalid_output", error: issues.slice(0, 2000) });
    throw new LlmOutputError(call.prompt.role, issues);
  }
  await call.record({ ...base, ...spend, status: "ok" });
  return { output: result.data, response };
}

export interface StructuredBatchItem {
  /** The caller's key for this question, returned with its answer. */
  id: string;
  user: string;
}

export interface StructuredBatchResult<T> {
  id: string;
  output?: T;
  error?: string;
}

/**
 * The same role, asked many questions at once and billed at half the token price.
 *
 * Every answer is validated and recorded exactly as a single call would be, so nothing is
 * trusted because it arrived in a batch. If the batch overruns, the questions are asked
 * one at a time instead: a dearer run is better than a day that does not finish.
 */
export async function runStructuredMany<S extends z.ZodType>(
  call: Omit<StructuredCall<S>, "user"> & { batch: BatchLlmClient; items: readonly StructuredBatchItem[] },
): Promise<StructuredBatchResult<z.infer<S>>[]> {
  if (call.items.length === 0) return [];
  const jsonSchema = toApiSchema(call.schema);

  const ask = (user: string): LlmRequest => ({
    model: call.model,
    system: call.prompt.system,
    user,
    jsonSchema,
    maxTokens: call.maxTokens ?? 16_000,
    effort: call.effort,
    webSearch: call.webSearch,
    depth: call.depth,
  });

  let outcomes: BatchOutcome[];
  try {
    outcomes = await call.batch.completeMany(call.items.map((item) => ({ id: item.id, request: ask(item.user) })));
  } catch (err) {
    if (!(err instanceof BatchTimeoutError)) throw err;
    // The batch is abandoned, not awaited: finishing the day matters more than the discount.
    console.warn(`${err.message}; falling back to one call at a time`);
    const results: StructuredBatchResult<z.infer<S>>[] = [];
    for (const item of call.items) {
      try {
        const { output } = await runStructured({ ...call, user: item.user });
        results.push({ id: item.id, output });
      } catch (single) {
        results.push({ id: item.id, error: single instanceof Error ? single.message : String(single) });
      }
    }
    return results;
  }

  const results: StructuredBatchResult<z.infer<S>>[] = [];
  for (const outcome of outcomes) {
    const base = {
      id: newId("llmCall"),
      runId: call.runId ?? null,
      role: call.prompt.role,
      promptVersion: call.prompt.version,
      inputHash: hashInput([call.prompt.system, outcome.id, jsonSchema, call.model]),
    };
    if (!outcome.response) {
      await call.record({ ...base, model: call.model, inputTokens: 0, outputTokens: 0, costUsd: 0, status: "error", error: outcome.error ?? "no answer" });
      results.push({ id: outcome.id, error: outcome.error ?? "no answer" });
      continue;
    }
    const response = outcome.response;
    const spend = {
      model: response.model,
      inputTokens: response.usage.inputTokens + response.usage.cacheCreationInputTokens + response.usage.cacheReadInputTokens,
      outputTokens: response.usage.outputTokens,
      // Batches bill tokens at half; the search requests inside them are not discounted.
      costUsd: costUsd(response.model, response.usage) / 2,
    };
    let parsed: unknown;
    try {
      parsed = JSON.parse(response.text);
    } catch {
      await call.record({ ...base, ...spend, status: "invalid_output", error: "the response was not JSON" });
      results.push({ id: outcome.id, error: "the response was not JSON" });
      continue;
    }
    const checked = call.schema.safeParse(parsed);
    if (!checked.success) {
      const issues = z.prettifyError(checked.error);
      await call.record({ ...base, ...spend, status: "invalid_output", error: issues.slice(0, 2000) });
      results.push({ id: outcome.id, error: issues });
      continue;
    }
    await call.record({ ...base, ...spend, status: "ok" });
    results.push({ id: outcome.id, output: checked.data });
  }
  return results;
}
