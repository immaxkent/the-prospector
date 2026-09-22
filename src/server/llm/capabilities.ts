/**
 * What each model will actually accept.
 *
 * These are not preferences: sending adaptive thinking to Haiku 4.5, or an effort level, or
 * the current web-search tool, each returns a 400. Keeping the differences in one table means
 * changing the model in Settings cannot silently break a role that uses a newer feature.
 */
export interface ModelCapabilities {
  /** "adaptive" on 4.6 and later; "budget" on Haiku 4.5 and older; "none" to send nothing. */
  thinking: "adaptive" | "budget" | "none";
  /** Whether output_config.effort is accepted. Haiku 4.5 errors on it. */
  effort: boolean;
  /** The web search tool type this model accepts. */
  webSearchTool: "web_search_20260209" | "web_search_20250305";
}

const MODERN: ModelCapabilities = { thinking: "adaptive", effort: true, webSearchTool: "web_search_20260209" };

const BY_MODEL: Record<string, ModelCapabilities> = {
  "claude-opus-5": MODERN,
  "claude-sonnet-5": MODERN,
  "claude-haiku-4-5": { thinking: "budget", effort: false, webSearchTool: "web_search_20250305" },
};

/** Unknown models are assumed current: new ones arrive with the newer surface, not the older. */
export function capabilitiesOf(model: string): ModelCapabilities {
  return BY_MODEL[model] ?? MODERN;
}

/** The lowest budget the API accepts, and it must leave room for an answer. */
export const MIN_THINKING_BUDGET = 1024;

/**
 * A thinking budget for models that take one, or null when there is no room for it.
 * It must be smaller than max_tokens, so a short call simply does not think.
 */
export function thinkingBudget(maxTokens: number) {
  const budget = Math.min(4000, Math.floor(maxTokens / 2));
  return budget >= MIN_THINKING_BUDGET ? budget : null;
}
