/** Scripted agent for e2e and local work without an API key. Answers by role, in any order. */
import { DRAFT_PROMPT } from "./draft";
import { REPLY_PROMPT } from "./reply";
import { RESEARCH_PROMPT, QUALIFY_PROMPT } from "./research-prompt";
import { QUALIFICATION_FACTORS } from "./qualify";
import type { LlmClient, LlmRequest, LlmResponse } from "../llm/types";

export const FIXTURE_SOURCE = { url: "https://havsledd.example/postmortem", title: "Testnet postmortem" };

export function fixtureResearchOutput() {
  return {
    candidates: [
      {
        company: { name: "Havsledd Labs", domain: "havsledd.example", description: "Vault protocol preparing for mainnet" },
        person: { name: "Tomas Lindqvist", role: "Lead engineer" },
        trigger: { type: "incident", description: "Published a testnet incident postmortem" },
        evidence: [
          {
            claim: "Postmortem cites missing invariant tests",
            sourceRef: FIXTURE_SOURCE.url,
            excerpt: "We lacked invariant tests on the vault contract.",
            confidence: 0.8,
          },
        ],
      },
    ],
    searchNotes: "fixture research: one candidate from a testnet postmortem",
  };
}

export function fixtureQualifyOutput() {
  return {
    factors: QUALIFICATION_FACTORS.map((factor) => ({
      factor,
      score: factor === "contactability" ? 4 : 8,
      note: `fixture assessment of ${factor}`,
      evidenceIds: [] as string[],
    })),
    recommendation: "review" as const,
    reason: "Fixture qualification: plausible fit, no confirmed contact address",
  };
}

export function fixtureDraftOutput() {
  const body =
    "Your testnet postmortem mentions missing invariant tests. I run fixed-scope pre-audit reviews of exactly that kind of vault logic. Worth a short look before mainnet?";
  return {
    subject: "Invariant tests before mainnet",
    body,
    citations: [{ sentence: "Your testnet postmortem mentions missing invariant tests.", id: "FIXTURE_EVIDENCE_ID" }],
  };
}

export function fixtureReplyOutput(reply: string) {
  const stop = /unsubscribe|stop contacting|do not contact|remove me/i.test(reply);
  return {
    intent: stop ? "unsubscribe" : "question",
    summary: stop ? "Asked not to be contacted again" : "Asked what the review costs",
    objections: [] as string[],
    commitments: [] as string[],
    requestedNextStep: stop ? null : "Send cost and scope",
    unsubscribeRequested: stop,
    suggestedReply: stop ? null : "Fixed scope, five working days. Happy to start Friday.",
    confidence: 0.7,
  };
}

export class FixtureAgentLlm implements LlmClient {
  readonly requests: LlmRequest[] = [];

  async complete(request: LlmRequest): Promise<LlmResponse> {
    this.requests.push(request);
    let output: unknown = {};
    if (request.system === RESEARCH_PROMPT.system) output = fixtureResearchOutput();
    else if (request.system === QUALIFY_PROMPT.system) output = fixtureQualifyOutput();
    else if (request.system === REPLY_PROMPT.system) {
      output = fixtureReplyOutput(request.user.split("<reply-to-read>")[1] ?? "");
    } else if (request.system === DRAFT_PROMPT.system) {
      // Cite the first evidence id the request actually offered, so the guard can verify it.
      const id = request.user.match(/<item id="([^"]+)">/)?.[1] ?? "unknown";
      const draft = fixtureDraftOutput();
      output = { ...draft, citations: draft.citations.map((c) => ({ ...c, id })) };
    }
    return {
      text: JSON.stringify(output),
      model: request.model,
      usage: { inputTokens: 500, outputTokens: 300, cacheCreationInputTokens: 0, cacheReadInputTokens: 0, webSearchRequests: request.webSearch ? 1 : 0 },
      sources: request.webSearch ? [FIXTURE_SOURCE] : [],
    };
  }
}
