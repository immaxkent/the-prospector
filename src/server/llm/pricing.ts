/**
 * USD list prices per million tokens (Anthropic first-party API) and per web search.
 * Used for cost accounting in llm_calls; update when prices change.
 */
export const MODEL_PRICES: Record<string, { input: number; output: number }> = {
  "claude-opus-5": { input: 5, output: 25 },
  "claude-opus-4-8": { input: 5, output: 25 },
  "claude-sonnet-5": { input: 2, output: 10 },
  "claude-haiku-4-5": { input: 1, output: 5 },
};

export const WEB_SEARCH_USD_PER_REQUEST = 10 / 1000;
const CACHE_WRITE_MULTIPLIER = 1.25;
const CACHE_READ_MULTIPLIER = 0.1;

export interface UsageForCost {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  webSearchRequests: number;
}

/**
 * The API answers with a dated variant of the model asked for — "claude-haiku-4-5-20251001"
 * for "claude-haiku-4-5" — so the date is stripped before pricing. Without this the dated
 * name looks unknown and is charged at the fallback rate, which on Haiku overstated spend
 * fivefold and made the budget stop the day's work long before the money ran out.
 */
export const basePriceKey = (model: string) => model.replace(/-\d{8}$/, "");

/** Cost of one call. Genuinely unknown models are priced at the most expensive listed rate so spend is never understated. */
export function costUsd(model: string, u: UsageForCost) {
  const fallback = Object.values(MODEL_PRICES).reduce((a, b) => (b.input > a.input ? b : a));
  const price = MODEL_PRICES[model] ?? MODEL_PRICES[basePriceKey(model)] ?? fallback;
  const perToken = (rate: number) => rate / 1_000_000;
  const cost =
    u.inputTokens * perToken(price.input) +
    u.cacheCreationInputTokens * perToken(price.input) * CACHE_WRITE_MULTIPLIER +
    u.cacheReadInputTokens * perToken(price.input) * CACHE_READ_MULTIPLIER +
    u.outputTokens * perToken(price.output) +
    u.webSearchRequests * WEB_SEARCH_USD_PER_REQUEST;
  return Math.round(cost * 1_000_000) / 1_000_000;
}
