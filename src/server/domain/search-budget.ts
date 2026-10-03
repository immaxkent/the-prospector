/**
 * How many web searches one research call is allowed.
 *
 * Search is charged per query and is the largest single cost in a run, so the cap follows
 * the work left rather than sitting at a fixed maximum. It starts low: a search returns many
 * candidates, and a call that already has what the day needs should not keep paying to look.
 * When a call comes back thin, the next one is allowed to look harder — up to a ceiling that
 * is never crossed, however badly the searching goes.
 */

/** Never fewer: one query is not enough to cross-check anything. */
export const MIN_SEARCHES = 2;

/** Never more, whatever the shortfall. The cost of looking has to stop somewhere. */
export const MAX_SEARCHES = 8;

/** Roughly how many usable candidates one search tends to yield. Deliberately modest. */
export const CANDIDATES_PER_SEARCH = 4;

/** A call returning less than this share of what was asked for was not looking hard enough. */
export const THIN_YIELD = 0.5;

/** The cap for a call that still needs `remaining` candidates. */
export function searchesFor(remaining: number) {
  if (remaining <= 0) return 0;
  const wanted = Math.ceil(remaining / CANDIDATES_PER_SEARCH);
  return Math.min(MAX_SEARCHES, Math.max(MIN_SEARCHES, wanted));
}

/**
 * The cap to retry with after a thin result, or null when retrying is not worth it.
 *
 * A bigger budget only helps a call that ran out of the one it had. When the model stopped
 * searching before reaching its cap, the segment is thin and paying to look again buys
 * nothing — which is the difference between a shortfall worth chasing and one that is simply
 * the market.
 */
export function escalatedSearches(previousCap: number, found: number, asked: number, searchesUsed: number) {
  if (previousCap >= MAX_SEARCHES) return null;
  if (asked <= 0) return null;
  /*
   * Nothing at all is not a thin result, it is a different result.
   *
   * A call that found some and not enough was looking in the right place and ran short.
   * A call that found *none* searched and came back with nothing matching, and doubling its
   * budget buys more of the same nothing. On 1 October two segments did exactly this, twice
   * each: four paid attempts, zero candidates.
   */
  if (found === 0) return null;
  if (found / asked >= THIN_YIELD) return null;
  if (searchesUsed < previousCap) return null;
  return Math.min(MAX_SEARCHES, Math.max(previousCap + 2, previousCap * 2));
}
