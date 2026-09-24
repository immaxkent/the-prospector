/**
 * Research role: find candidates for one segment, with evidence from pages the model actually read.
 * Claims whose source was never opened are dropped here, before anything is stored.
 */
import { z } from "zod/v4";
import type { CallRecorder } from "../llm/structured";
import { runStructured } from "../llm/structured";
import type { LlmClient, WebSource } from "../llm/types";
import { RESEARCH_PROMPT } from "./research-prompt";

const nonEmpty = z.string().trim().min(1);

export const evidenceClaimSchema = z.object({
  claim: nonEmpty.max(300),
  sourceRef: z.url(),
  excerpt: nonEmpty.max(600),
  confidence: z.number().min(0).max(1),
});

export const candidateSchema = z.object({
  company: z.object({
    name: nonEmpty.max(200),
    domain: z.string().max(200).optional(),
    description: z.string().max(600).optional(),
    /** IANA timezone of where the team works, when the sources say. Used to send in their morning. */
    timezone: z.string().max(60).optional(),
  }),
  person: z
    .object({ name: nonEmpty.max(120), role: z.string().max(120).optional(), email: z.email().optional(), linkedinUrl: z.url().optional() })
    .optional(),
  trigger: z.object({ type: nonEmpty.max(60), description: nonEmpty.max(300) }),
  evidence: z.array(evidenceClaimSchema).min(1),
});

export const researchOutputSchema = z.object({
  candidates: z.array(candidateSchema),
  /** What the model searched for, so a thin run can be understood. */
  searchNotes: z.string().max(1000),
});

export type Candidate = z.infer<typeof candidateSchema>;
export type EvidenceClaim = z.infer<typeof evidenceClaimSchema>;

function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

export interface VerificationResult {
  candidates: Candidate[];
  droppedClaims: number;
  droppedCandidates: number;
}

/**
 * Keeps only evidence whose source was among the pages search actually returned.
 * A candidate with no verifiable evidence left is dropped: research never invents sources.
 */
export function verifyAgainstSources(candidates: readonly Candidate[], sources: readonly WebSource[]): VerificationResult {
  const seen = new Set(sources.map((s) => hostOf(s.url)).filter((h): h is string => !!h));
  let droppedClaims = 0;
  let droppedCandidates = 0;
  const kept: Candidate[] = [];

  for (const candidate of candidates) {
    const evidence = candidate.evidence.filter((e) => {
      const host = hostOf(e.sourceRef);
      const ok = !!host && seen.has(host);
      if (!ok) droppedClaims += 1;
      return ok;
    });
    if (evidence.length === 0) {
      droppedCandidates += 1;
      continue;
    }
    kept.push({ ...candidate, evidence });
  }
  return { candidates: kept, droppedClaims, droppedCandidates };
}

export interface ResearchRequest {
  segment: { name: string; definition: string; signals: string[]; painHypothesis: string };
  offering: string;
  exclusions: string[];
  knownTargets: string[];
  wanted: number;
  today: string;
}

export function renderResearchInput(req: ResearchRequest) {
  const lines = [
    `Today is ${req.today}.`,
    `Find up to ${req.wanted} candidate companies for this segment.`,
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
  ];
  if (req.exclusions.length) lines.push("", "<exclusions>", ...req.exclusions.map((e) => `- ${e}`), "</exclusions>");
  if (req.knownTargets.length) {
    lines.push("", "<already-known>", ...req.knownTargets.slice(0, 200).map((t) => `- ${t}`), "</already-known>");
  }
  return lines.join("\n");
}

export interface ResearchDeps {
  llm: LlmClient;
  record: CallRecorder;
  model: string;
  runId?: string | null;
  maxSearches?: number;
}

export async function researchCandidates(deps: ResearchDeps, req: ResearchRequest) {
  const { output, response } = await runStructured({
    llm: deps.llm,
    record: deps.record,
    prompt: RESEARCH_PROMPT,
    schema: researchOutputSchema,
    user: renderResearchInput(req),
    model: deps.model,
    effort: "high",
    depth: "deep",
    webSearch: { maxUses: deps.maxSearches ?? 8 },
    runId: deps.runId ?? null,
  });

  const verified = verifyAgainstSources(output.candidates, response.sources);
  return {
    ...verified,
    searchNotes: output.searchNotes,
    sources: response.sources,
    proposed: output.candidates.length,
    /** What the searching actually cost, which is rarely the cap it was allowed. */
    searches: response.usage.webSearchRequests,
  };
}
