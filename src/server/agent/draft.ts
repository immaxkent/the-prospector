/**
 * Drafting role. Every claim about the prospect must cite stored evidence, and every claim
 * about the sender must cite a proof item from the spec. Drafts that break this are refused,
 * never quietly trimmed (handoff §4, §13).
 */
import { z } from "zod/v4";
import type { PromptDefinition } from "../llm/structured";
import type { BatchLlmClient } from "../llm/batch";
import { runStructured, runStructuredMany } from "../llm/structured";
import type { CallRecorder } from "../llm/structured";
import type { LlmClient } from "../llm/types";

export const DRAFT_PROMPT: PromptDefinition = {
  role: "outreach.draft",
  version: "2026-09-17.1",
  system: `You write one short cold outreach email from an operator to a prospect.

Every factual claim must be backed:
- A claim about the prospect or their company cites the evidence id it comes from.
- A claim about the sender (experience, clients, results, products) cites a proof id from the sender's proof list.
- If you cannot back a claim, leave it out. An email with fewer specifics is better than one with an invented one.

Write like a person: plain sentences, no marketing voice, no flattery, no invented mutual connections. Keep it under 150 words, end with one clear, low-friction question. Do not promise prices, dates or scope beyond what the offer says.

Return the subject, the body, and one citation per backed sentence: the sentence exactly as it appears in the body, and the id that backs it.`,
};

export const draftOutputSchema = z.object({
  subject: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(4000),
  citations: z
    .array(
      z.object({
        sentence: z.string().trim().min(1).max(500),
        /** An evidence id for prospect claims, or a proof id for sender claims. */
        id: z.string().trim().min(1).max(64),
      }),
    )
    .default([]),
});

export type DraftOutput = z.infer<typeof draftOutputSchema>;

export interface ProofItemRef {
  id: string;
  title: string;
  claim: string;
  url?: string | undefined;
}

export interface DraftGuardInput {
  evidenceIds: readonly string[];
  proof: readonly ProofItemRef[];
  /** Set when the operator marked proof not applicable: the email may say nothing about the sender. */
  senderClaimsAllowed: boolean;
}

export type ViolationCode =
  | "citation_unknown_id"
  | "citation_not_in_body"
  | "no_evidence_cited"
  | "sender_claim_without_proof"
  | "unsourced_link";

export interface Violation {
  code: ViolationCode;
  detail: string;
}

const normalise = (text: string) => text.replace(/\s+/g, " ").trim().toLowerCase();

/**
 * Checks a draft against what is actually known. Returns every violation found;
 * the caller refuses the draft rather than sending something unsupported.
 */
export function checkDraft(draft: DraftOutput, input: DraftGuardInput) {
  const violations: Violation[] = [];
  const evidence = new Set(input.evidenceIds);
  const proof = new Map(input.proof.map((p) => [p.id, p]));
  const body = normalise(draft.body);

  let evidenceCitations = 0;
  for (const citation of draft.citations) {
    const isEvidence = evidence.has(citation.id);
    const isProof = proof.has(citation.id);
    if (!isEvidence && !isProof) {
      violations.push({ code: "citation_unknown_id", detail: `citation "${citation.id}" matches no evidence or proof` });
      continue;
    }
    if (!body.includes(normalise(citation.sentence))) {
      violations.push({ code: "citation_not_in_body", detail: `cited sentence is not in the body: "${citation.sentence}"` });
      continue;
    }
    if (isProof && !input.senderClaimsAllowed) {
      violations.push({ code: "sender_claim_without_proof", detail: "the email claims something about the sender, but proof is marked not applicable" });
      continue;
    }
    if (isEvidence) evidenceCitations += 1;
  }

  if (evidenceCitations === 0) {
    violations.push({ code: "no_evidence_cited", detail: "nothing in the email is backed by evidence about this prospect" });
  }

  // Links must come from evidence or proof: the model cannot introduce its own.
  const allowedLinks = new Set(input.proof.map((p) => p.url).filter((u): u is string => !!u));
  for (const url of draft.body.match(/https?:\/\/[^\s)>\]]+/g) ?? []) {
    const clean = url.replace(/[.,;]$/, "");
    if (![...allowedLinks].some((allowed) => clean.startsWith(allowed))) {
      violations.push({ code: "unsourced_link", detail: `the email links to ${clean}, which is not in the sender's proof` });
    }
  }

  return { ok: violations.length === 0, violations, evidenceCitations };
}

export interface DraftRequest {
  prospect: { company: string; person: string | null; role: string | null };
  segment: { name: string; painHypothesis: string };
  offering: string;
  pricing: string | null;
  evidence: readonly { id: string; claim: string; sourceRef: string }[];
  proof: readonly ProofItemRef[];
  senderName: string;
  messageClass: "new_outreach" | "follow_up";
  /** Earlier messages in the thread, oldest first, for a follow-up. */
  history: readonly { direction: "outbound" | "inbound"; body: string }[];
  today: string;
}

export function renderDraftInput(req: DraftRequest) {
  const lines = [
    `Today is ${req.today}. Write a ${req.messageClass === "follow_up" ? "follow-up" : "first"} email.`,
    "",
    "<sender>",
    `name: ${req.senderName}`,
    `offer: ${req.offering}`,
    `pricing you may mention: ${req.pricing ?? "do not mention price"}`,
    "</sender>",
    "",
    "<prospect>",
    `company: ${req.prospect.company}`,
    `person: ${req.prospect.person ?? "no named contact"}`,
    `role: ${req.prospect.role ?? "unknown"}`,
    `segment: ${req.segment.name} — ${req.segment.painHypothesis}`,
    "</prospect>",
    "",
    "<evidence>",
  ];
  for (const e of req.evidence) lines.push(`<item id="${e.id}">`, e.claim, `source: ${e.sourceRef}`, "</item>");
  lines.push("</evidence>", "", "<proof>");
  if (req.proof.length === 0) {
    lines.push("none: do not make any claim about the sender's experience, clients or results");
  } else {
    for (const p of req.proof) lines.push(`<item id="${p.id}">`, `${p.title}: ${p.claim}`, ...(p.url ? [`link: ${p.url}`] : []), "</item>");
  }
  lines.push("</proof>");
  if (req.history.length) {
    lines.push("", "<thread>");
    for (const m of req.history) lines.push(`<message from="${m.direction === "outbound" ? "sender" : "prospect"}">`, m.body, "</message>");
    lines.push("</thread>");
  }
  return lines.join("\n");
}

export interface DraftDeps {
  llm: LlmClient;
  record: CallRecorder;
  model: string;
  runId?: string | null;
}

export interface DraftResult {
  ok: boolean;
  draft: DraftOutput;
  violations: Violation[];
  /** Evidence the email actually leans on, stored with the message. */
  citedEvidenceIds: string[];
}

/** The day's drafts written together. Every one is checked exactly as a single draft is. */
export async function draftOutreachMany(
  deps: DraftDeps & { batch: BatchLlmClient },
  items: readonly { id: string; req: DraftRequest }[],
): Promise<{ id: string; result?: DraftResult; error?: string }[]> {
  const byId = new Map(items.map((i) => [i.id, i.req]));
  const results = await runStructuredMany({
    llm: deps.llm,
    batch: deps.batch,
    record: deps.record,
    prompt: DRAFT_PROMPT,
    schema: draftOutputSchema,
    items: items.map((i) => ({ id: i.id, user: renderDraftInput(i.req) })),
    model: deps.model,
    depth: "standard",
    effort: "medium",
    runId: deps.runId ?? null,
  });

  return results.map((r) => {
    const req = byId.get(r.id);
    if (!r.output || !req) return { id: r.id, error: r.error ?? "no answer" };
    const evidenceIds = req.evidence.map((e) => e.id);
    const check = checkDraft(r.output, { evidenceIds, proof: req.proof, senderClaimsAllowed: req.proof.length > 0 });
    const cited = r.output.citations.filter((c) => evidenceIds.includes(c.id)).map((c) => c.id);
    return { id: r.id, result: { ok: check.ok, draft: r.output, violations: check.violations, citedEvidenceIds: [...new Set(cited)] } };
  });
}

export async function draftOutreach(deps: DraftDeps, req: DraftRequest): Promise<DraftResult> {
  const { output } = await runStructured({
    llm: deps.llm,
    record: deps.record,
    prompt: DRAFT_PROMPT,
    schema: draftOutputSchema,
    user: renderDraftInput(req),
    model: deps.model,
    depth: "standard",
    effort: "medium",
    runId: deps.runId ?? null,
  });

  const evidenceIds = req.evidence.map((e) => e.id);
  const check = checkDraft(output, { evidenceIds, proof: req.proof, senderClaimsAllowed: req.proof.length > 0 });
  const cited = output.citations.filter((c) => evidenceIds.includes(c.id)).map((c) => c.id);
  return { ok: check.ok, draft: output, violations: check.violations, citedEvidenceIds: [...new Set(cited)] };
}
