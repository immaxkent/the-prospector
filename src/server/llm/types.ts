import type { UsageForCost } from "./pricing";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export interface LlmRequest {
  model: string;
  system: string;
  user: string;
  /** JSON schema the final answer must follow (structured outputs). */
  jsonSchema: Record<string, unknown>;
  maxTokens: number;
  effort?: Effort | undefined;
  /** Enables Claude's server-side web search with a per-call cap. */
  webSearch?: { maxUses: number } | undefined;
}

export interface WebSource {
  url: string;
  title: string;
}

export interface LlmResponse {
  /** Final text, expected to be JSON matching the schema. */
  text: string;
  /** Model that produced the answer (may differ from the request after a server-side fallback). */
  model: string;
  usage: UsageForCost;
  /** Every page web search returned, so claims can be checked against real sources. */
  sources: WebSource[];
}

export interface LlmClient {
  complete(request: LlmRequest): Promise<LlmResponse>;
}

export class LlmRefusalError extends Error {
  constructor(readonly category: string | null) {
    super(`the model declined the request${category ? ` (${category})` : ""}`);
  }
}
