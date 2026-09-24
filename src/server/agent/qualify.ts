/**
 * Qualification role. The model interprets evidence factor by factor; the application
 * stores the factors, computes the score and decides the outcome (handoff §8).
 */
import { z } from "zod/v4";
import type { ScoreFactor } from "../db/schema";
import type { CallRecorder } from "../llm/structured";
import type { BatchLlmClient } from "../llm/batch";
import { runStructured, runStructuredMany } from "../llm/structured";
import type { LlmClient } from "../llm/types";
import { QUALIFY_PROMPT } from "./research-prompt";

export const QUALIFICATION_FACTORS = [
  "icp_fit",
  "trigger_strength",
  "likely_pain",
  "decision_maker",
  "evidence_quality",
  "timing",
  "contactability",
] as const;

export type QualificationFactor = (typeof QUALIFICATION_FACTORS)[number];

/** Weights sum to 1; the score is the weighted average on a 0-100 scale. */
export const FACTOR_WEIGHTS: Record<QualificationFactor, number> = {
  icp_fit: 0.2,
  trigger_strength: 0.2,
  likely_pain: 0.15,
  decision_maker: 0.15,
  evidence_quality: 0.1,
  timing: 0.1,
  contactability: 0.1,
};

export const QUALIFY_THRESHOLD = 65;
export const REJECT_THRESHOLD = 40;

export const qualifyOutputSchema = z.object({
  factors: z
    .array(
      z.object({
        factor: z.enum(QUALIFICATION_FACTORS),
        score: z.number().min(0).max(10),
        note: z.string().trim().min(1).max(300),
        evidenceIds: z.array(z.string().min(1)),
      }),
    )
    .min(1),
  recommendation: z.enum(["qualify", "review", "reject"]),
  reason: z.string().trim().min(1).max(500),
});

export type QualifyOutput = z.infer<typeof qualifyOutputSchema>;

export interface EvidenceForQualification {
  id: string;
  claim: string;
  sourceRef: string;
  capturedAt: string;
  confidence: number;
}

export interface QualifyRequest {
  segment: { name: string; definition: string; signals: string[]; painHypothesis: string };
  offering: string;
  exclusions: string[];
  prospect: { company: string; person: string | null; role: string | null; hasEmail: boolean; trigger: string | null };
  evidence: readonly EvidenceForQualification[];
  today: string;
}

export function renderQualifyInput(req: QualifyRequest) {
  const lines = [
    `Today is ${req.today}.`,
    "",
    "<segment>",
    `name: ${req.segment.name}`,
    `definition: ${req.segment.definition}`,
    `signals: ${req.segment.signals.join("; ") || "none given"}`,
    `pain hypothesis: ${req.segment.painHypothesis}`,
    "</segment>",
    "",
    "<offering>",
    req.offering,
    "</offering>",
    "",
    "<prospect>",
    `company: ${req.prospect.company}`,
    `person: ${req.prospect.person ?? "no named contact"}`,
    `role: ${req.prospect.role ?? "unknown"}`,
    `reachable by email: ${req.prospect.hasEmail ? "yes" : "no"}`,
    `trigger: ${req.prospect.trigger ?? "none recorded"}`,
    "</prospect>",
  ];
  if (req.exclusions.length) lines.push("", "<exclusions>", ...req.exclusions.map((e) => `- ${e}`), "</exclusions>");
  lines.push("", "<evidence>");
  for (const e of req.evidence) {
    lines.push(`<item id="${e.id}" confidence="${e.confidence}" capturedAt="${e.capturedAt}">`, e.claim, `source: ${e.sourceRef}`, "</item>");
  }
  lines.push("</evidence>");
  return lines.join("\n");
}

export interface Qualification {
  score: number;
  factors: ScoreFactor[];
  reason: string;
  outcome: "qualified" | "needs_review" | "rejected";
  /** Citations the model made up; they are removed and counted rather than trusted. */
  droppedCitations: number;
}

/**
 * Turns the model's factors into a stored score and an outcome.
 * Missing factors count as zero, so silence never inflates a score.
 */
export function scoreQualification(output: QualifyOutput, evidenceIds: readonly string[]): Qualification {
  const known = new Set(evidenceIds);
  let droppedCitations = 0;
  const byFactor = new Map<QualificationFactor, (typeof output.factors)[number]>();
  for (const f of output.factors) byFactor.set(f.factor, f);

  const factors: ScoreFactor[] = QUALIFICATION_FACTORS.map((factor) => {
    const given = byFactor.get(factor);
    const cited = (given?.evidenceIds ?? []).filter((id) => {
      if (known.has(id)) return true;
      droppedCitations += 1;
      return false;
    });
    return {
      factor,
      score: given?.score ?? 0,
      weight: FACTOR_WEIGHTS[factor],
      note: given?.note ?? "Not assessed",
      evidenceIds: cited,
    };
  });

  const score = Math.round(factors.reduce((sum, f) => sum + f.score * f.weight, 0) * 10);
  const outcome =
    output.recommendation === "reject" || score < REJECT_THRESHOLD
      ? "rejected"
      : output.recommendation === "qualify" && score >= QUALIFY_THRESHOLD
        ? "qualified"
        : "needs_review";

  return { score, factors, reason: output.reason, outcome, droppedCitations };
}

export interface QualifyDeps {
  llm: LlmClient;
  record: CallRecorder;
  model: string;
  runId?: string | null;
}

/**
 * Qualifying a whole day's prospects at once. Same prompt, same schema, same scoring: only
 * the billing and the waiting differ.
 */
export async function qualifyProspects(
  deps: QualifyDeps & { batch: BatchLlmClient },
  items: readonly { id: string; req: QualifyRequest }[],
): Promise<{ id: string; qualification?: Qualification; error?: string }[]> {
  const byId = new Map(items.map((i) => [i.id, i.req]));
  const results = await runStructuredMany({
    llm: deps.llm,
    batch: deps.batch,
    record: deps.record,
    prompt: QUALIFY_PROMPT,
    schema: qualifyOutputSchema,
    items: items.map((i) => ({ id: i.id, user: renderQualifyInput(i.req) })),
    model: deps.model,
    depth: "light",
    effort: "medium",
    runId: deps.runId ?? null,
  });
  return results.map((r) =>
    r.output
      ? { id: r.id, qualification: scoreQualification(r.output, (byId.get(r.id)?.evidence ?? []).map((e) => e.id)) }
      : { id: r.id, error: r.error ?? "no answer" },
  );
}

export async function qualifyProspect(deps: QualifyDeps, req: QualifyRequest): Promise<Qualification> {
  const { output } = await runStructured({
    llm: deps.llm,
    record: deps.record,
    prompt: QUALIFY_PROMPT,
    schema: qualifyOutputSchema,
    user: renderQualifyInput(req),
    model: deps.model,
    depth: "light",
    effort: "medium",
    runId: deps.runId ?? null,
  });
  return scoreQualification(output, req.evidence.map((e) => e.id));
}
