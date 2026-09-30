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
import { describeProviderError } from "./provider-errors";
import type { Depth, Effort, LlmClient, LlmRequest, LlmResponse } from "./types";

export interface PromptDefinition {
  /** Stable role name, e.g. "intake.planner". */
  role: string;
  /** Bumped whenever the system prompt or schema changes. */
  version: string;
  system: string;
}

/**
 * What the model actually returned, when it returned something unusable.
 *
 * "The response was not JSON" says nothing a fix can be built on: prose wrapped round the
 * object, a refusal, a fenced block and an empty string all read the same. Both ends are
 * kept, because a truncation shows at the tail and a preamble at the head, and the middle
 * of four thousand tokens is rarely the part that explains it.
 */
export function outputSnippet(text: string, keep = 400): string {
  const clean = text.trim();
  if (clean.length === 0) return "(empty response)";
  if (clean.length <= keep * 2) return clean;
  return `${clean.slice(0, keep)}\n…[${clean.length - keep * 2} more characters]…\n${clean.slice(-keep)}`;
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
    /** The fields that failed, so the message can name them. Empty when the answer was not JSON at all. */
    readonly fields: readonly string[] = [],
  ) {
    // Named, because this message is what the operator is shown. "Does not match its
    // schema" on its own leaves them with nothing to look at and nothing to change; the
    // field tells them it was the deadline, or the price, or the buyers.
    super(`${role} returned output that does not match its schema${fields.length ? ` (${fields.join(", ")})` : ""}`);
  }
}

/**
 * The fields a schema failure was about, deduplicated and in the order they were reported.
 *
 * The state unions put the useful name at the end of a long path — `spec.horizon.value.endsOn`
 * — and the union arm number in the middle of it, which names nothing. Both are dropped, so
 * what is left is what the operator recognises.
 */
export function failedFields(error: z.ZodError, keep = 3): string[] {
  const named = error.issues.map((issue) =>
    issue.path.filter((part) => typeof part === "string" && part !== "value").join("."),
  );
  return [...new Set(named.filter(Boolean))].slice(0, keep);
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

/**
 * How the correction is put to the model on the second attempt.
 *
 * The issues name the field and the snippet shows what was in it, so the model is not
 * asked to guess what it got wrong. Exported because a test that asserts the retry
 * happened should assert it said something useful.
 */
export function correctionMessage(user: string, issues: string): string {
  return `${user}\n\nYour previous answer was rejected because it did not match the required shape. Fix exactly these problems and return the whole answer again:\n${issues}`;
}

export async function runStructured<S extends z.ZodType>(call: StructuredCall<S>): Promise<{ output: z.infer<S>; response: LlmResponse }> {
  const jsonSchema = toApiSchema(call.schema);
  const record = (extra: Partial<LlmCallRecord> & Pick<LlmCallRecord, "model" | "inputTokens" | "outputTokens" | "costUsd" | "status">) =>
    call.record({
      id: newId("llmCall"),
      runId: call.runId ?? null,
      role: call.prompt.role,
      promptVersion: call.prompt.version,
      inputHash: hashInput([call.prompt.system, call.user, jsonSchema, call.model]),
      ...extra,
    });

  /**
   * One attempt. Returns the parsed output, or the reason it could not be used.
   *
   * A provider error is thrown rather than returned: a refusal, a timeout or an exhausted
   * budget is not something a differently-worded question would fix, and retrying it would
   * only spend the budget twice.
   */
  const attempt = async (user: string): Promise<{ ok: true; output: z.infer<S>; response: LlmResponse } | { ok: false; issues: string; fields: string[] }> => {
    let response: LlmResponse;
    try {
      response = await call.llm.complete({
        model: call.model,
        system: call.prompt.system,
        user,
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
      // Recorded and logged: a provider's refusal is the most useful thing it ever says, and
      // what it does not say — which of several causes this is — is added beside it.
      const described = describeProviderError(reason);
      console.error(`llm call ${call.prompt.role} failed: ${described}`);
      await record({ model: call.model, inputTokens: 0, outputTokens: 0, costUsd: 0, status: "error", error: described.slice(0, 2000) });
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
      const shown = `the response was not JSON\n${outputSnippet(response.text)}`;
      console.error(`llm call ${call.prompt.role} returned unparseable output:\n${outputSnippet(response.text)}`);
      await record({ ...spend, status: "invalid_output", error: shown.slice(0, 2000) });
      return { ok: false, issues: "response was not JSON", fields: [] };
    }

    const result = call.schema.safeParse(parsed);
    if (!result.success) {
      // The issues say which field; the snippet says what was in it. A schema failure without
      // the value is a fix built on a guess.
      const issues = `${z.prettifyError(result.error)}\n${outputSnippet(response.text, 200)}`;
      // Logged as well as recorded. The provider-error path above logs and this one did not,
      // so the one failure that carries its own diagnosis was the one you could not read
      // without the database — which is how an intake failure cost an evening.
      console.error(`llm call ${call.prompt.role} returned output that does not match its schema:\n${issues}`);
      await record({ ...spend, status: "invalid_output", error: issues.slice(0, 2000) });
      return { ok: false, issues, fields: failedFields(result.error) };
    }

    await record({ ...spend, status: "ok" });
    return { ok: true, output: result.data, response };
  };

  const first = await attempt(call.user);
  if (first.ok) return { output: first.output, response: first.response };

  /*
   * One retry, and only one.
   *
   * Output shape is the one failure a second ask can genuinely fix: the model is told what
   * it got wrong in the same words the parser used. Where it cannot fix it — a schema the
   * grammar will not express, a constraint nothing in the prompt mentions — the second
   * attempt fails the same way, and a third would only cost more to learn the same thing.
   *
   * Both attempts are recorded, so the spend is visible rather than hidden inside one call.
   */
  const second = await attempt(correctionMessage(call.user, first.issues));
  if (second.ok) return { output: second.output, response: second.response };
  throw new LlmOutputError(call.prompt.role, second.issues, second.fields);
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
