/**
 * Intake planner: brief (+ answers) → draft EndeavourSpec + questions.
 * The model proposes; quote verification and the activation gate decide.
 */
import { z } from "zod/v4";
import {
  FIELD_KEYS,
  downgradeUnverifiedQuotes,
  plannerSpecSchema,
  type EndeavourSpec,
  type FieldKey,
  type FieldState,
  type PlannerSpec,
} from "../domain/endeavour-spec";
import type { CallRecorder } from "../llm/structured";
import { runStructured } from "../llm/structured";
import type { LlmClient } from "../llm/types";
import { PLANNER_PROMPT, operatorText, renderPlannerInput, type IntakeAnswer } from "./prompt";

const PLANNER_FIELDS = FIELD_KEYS.filter((k): k is Exclude<FieldKey, "mailboxId"> => k !== "mailboxId");

/**
 * The planner runs in passes rather than one call.
 *
 * Every field is a union of states, each with its own value type, and asking for all nine at
 * once compiles to a grammar the API refuses outright ("the compiled grammar is too large").
 * Grouping related fields keeps each grammar small, and intake happens once per endeavour, so
 * a few cheap calls cost nothing worth saving.
 */
export const PLANNER_PASSES: readonly (readonly Exclude<FieldKey, "mailboxId">[])[] = [
  ["objective", "horizon", "cadence"],
  ["offering", "pricing"],
  ["proof"],
  ["buyers", "exclusions"],
];

export const plannerOutputSchema = z.object({
  spec: plannerSpecSchema,
  questions: z.array(z.object({ field: z.enum(PLANNER_FIELDS), question: z.string().trim().min(1) })),
});

export interface PlannerQuestion {
  field: Exclude<FieldKey, "mailboxId">;
  question: string;
}

export const FALLBACK_QUESTIONS: Record<Exclude<FieldKey, "mailboxId">, string> = {
  objective: "What outcome should this endeavour achieve, and how will you measure it?",
  horizon: "By when should it be achieved, or how often should progress be reviewed if it is ongoing?",
  offering: "What exactly do you sell here, and what does the buyer receive?",
  pricing: "What is the price or rate, and what is the smallest deal you would accept?",
  proof: "What proof can outreach point to, and what link can a recipient open to check it: repos, published reports, products, profiles or results?",
  buyers: "Who buys this, and what signals show they need it now?",
  exclusions: "Who will you not work with? Say 'none' if there are no exclusions.",
  cadence: "How many new prospects and follow-ups should be handled each day?",
};

export interface PlanInput {
  brief: string;
  answers: readonly IntakeAnswer[];
  today: string;
}

export interface PlanDeps {
  llm: LlmClient;
  record: CallRecorder;
  model: string;
}

/** The output schema for one pass: the same shapes, narrowed to the fields it is asked for. */
export function passSchema(fields: readonly Exclude<FieldKey, "mailboxId">[]) {
  const shape = plannerSpecSchema.shape as Record<string, z.ZodTypeAny>;
  const picked: Record<string, z.ZodTypeAny> = { name: shape["name"]!, kind: shape["kind"]! };
  for (const field of fields) picked[field] = shape[field]!;
  return z.object({
    spec: z.object(picked),
    questions: z.array(z.object({ field: z.enum(fields as [string, ...string[]]), question: z.string().trim().min(1) })),
  });
}

export async function planIntake(deps: PlanDeps, input: PlanInput) {
  const user = renderPlannerInput(input.brief, input.answers, input.today);

  // Passes are independent: each reads the whole brief and fills only its own fields.
  const results = await Promise.all(
    PLANNER_PASSES.map((fields) =>
      runStructured({
        llm: deps.llm,
        record: deps.record,
        prompt: PLANNER_PROMPT,
        schema: passSchema(fields),
        user: `${user}\n\nFill only these fields on this pass: ${fields.join(", ")}. Ask a question for each one you mark "suggested" or "missing".`,
        model: deps.model,
        effort: "high",
      }),
    ),
  );

  const merged: Record<string, unknown> = { name: "", kind: "sprint" };
  const rawQuestions: { field: string; question: string }[] = [];
  for (const [index, { output }] of results.entries()) {
    const spec = output.spec as Record<string, unknown>;
    // The first pass names the endeavour; later passes repeat it and are ignored.
    if (index === 0) {
      merged["name"] = spec["name"];
      merged["kind"] = spec["kind"];
    }
    for (const field of PLANNER_PASSES[index]!) merged[field] = spec[field];
    rawQuestions.push(...(output.questions as { field: string; question: string }[]));
  }

  const output = plannerOutputSchema.parse({ spec: merged, questions: rawQuestions });
  const verified = downgradeUnverifiedQuotes(output.spec, operatorText(input.brief, input.answers));

  // Every open field gets exactly one question, even if the model skipped it.
  const asked = new Map(output.questions.map((q) => [q.field, q.question]));
  const questions: PlannerQuestion[] = PLANNER_FIELDS.filter((f) => {
    const s = (verified[f] as FieldState<unknown>).state;
    return s === "suggested" || s === "missing";
  }).map((field) => ({ field, question: asked.get(field) ?? FALLBACK_QUESTIONS[field] }));

  return { spec: verified, questions };
}

/**
 * Merges a fresh plan into the stored draft. Anything the operator confirmed or marked
 * not applicable survives re-planning; everything else takes the planner's latest view.
 */
export function mergeDraft(previous: EndeavourSpec | null, plan: PlannerSpec): EndeavourSpec {
  const keep = (key: Exclude<FieldKey, "mailboxId">) => {
    const prior = previous?.[key] as FieldState<unknown> | undefined;
    return prior && (prior.state === "confirmed" || prior.state === "not_applicable") ? prior : plan[key];
  };
  return {
    name: previous?.name ?? plan.name,
    kind: previous?.kind ?? plan.kind,
    objective: keep("objective") as EndeavourSpec["objective"],
    horizon: keep("horizon") as EndeavourSpec["horizon"],
    offering: keep("offering") as EndeavourSpec["offering"],
    pricing: keep("pricing") as EndeavourSpec["pricing"],
    proof: keep("proof") as EndeavourSpec["proof"],
    buyers: keep("buyers") as EndeavourSpec["buyers"],
    exclusions: keep("exclusions") as EndeavourSpec["exclusions"],
    cadence: keep("cadence") as EndeavourSpec["cadence"],
    mailboxId: previous?.mailboxId ?? { state: "missing" },
    channels: ["email"],
    autonomyLevel: previous?.autonomyLevel ?? "DRAFT",
  };
}
