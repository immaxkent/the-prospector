/**
 * Turning a provider's refusal into something worth acting on.
 *
 * The raw text is kept — it is the evidence, and a translation that replaces it leaves
 * nobody able to check the translation. What is added is the distinction the operator
 * cannot see from the message alone.
 *
 * The case that prompted this: `503 credential validation failed`. An org had credit and a
 * live key, so "out of credit" would have been wrong and "invalid key" would have been
 * wrong, and the honest answer — the key is recognised and refused, which is a workspace
 * setting rather than a balance — is not something the message says.
 */

export interface ProviderDiagnosis {
  /** What the provider said, unaltered. */
  raw: string;
  /** What it distinguishes, when it distinguishes anything. Empty when the answer is unknown. */
  hint: string;
}

/**
 * A key the provider does not recognise answers 401. A key it recognises and refuses
 * answers 503 with this text — which is a different thing, and the difference is the
 * whole diagnosis.
 */
const REFUSED_BUT_KNOWN = /credential validation failed/i;
const NOT_RECOGNISED = /\b401\b|invalid x-api-key|authentication_error/i;
const OUT_OF_CREDIT = /credit balance is too low|insufficient.*credit|billing/i;
const RATE_LIMITED = /\b429\b|rate.?limit/i;
const OVERLOADED = /overloaded_error|\b529\b/i;

export function diagnoseProviderError(message: string): ProviderDiagnosis {
  const raw = message.trim();

  // Order matters: the credit and rate-limit messages are specific, and the generic
  // auth patterns would otherwise swallow them.
  if (OUT_OF_CREDIT.test(raw)) {
    return { raw, hint: "The account is out of credit. Top it up in the Anthropic console." };
  }
  if (RATE_LIMITED.test(raw)) {
    return { raw, hint: "Rate limited. This usually clears on its own; the run will retry." };
  }
  if (OVERLOADED.test(raw)) {
    return { raw, hint: "Anthropic is overloaded. Nothing is wrong here; try again shortly." };
  }
  if (REFUSED_BUT_KNOWN.test(raw)) {
    return {
      raw,
      hint:
        "Anthropic recognises this key and is refusing it — an unknown key answers 401 instead. " +
        "That points at the workspace rather than the key: check the workspace's own spend limit " +
        "and that it is not archived. A workspace limit is separate from the account's credit balance, " +
        "so there can be credit left and still no access.",
    };
  }
  if (NOT_RECOGNISED.test(raw)) {
    return { raw, hint: "Anthropic does not recognise this key. Check ANTHROPIC_API_KEY on the server." };
  }
  return { raw, hint: "" };
}

/** The line that gets recorded and logged: the provider's words, then ours if we have any. */
export function describeProviderError(message: string): string {
  const { raw, hint } = diagnoseProviderError(message);
  return hint ? `${raw}\n${hint}` : raw;
}
