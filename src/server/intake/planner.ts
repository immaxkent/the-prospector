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

export async function planIntake(deps: PlanDeps, input: PlanInput) {
  const { output } = await runStructured({
    llm: deps.llm,
    record: deps.record,
    prompt: PLANNER_PROMPT,
    schema: plannerOutputSchema,
    user: renderPlannerInput(input.brief, input.answers, input.today),
    model: deps.model,
    effort: "high",
  });

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
