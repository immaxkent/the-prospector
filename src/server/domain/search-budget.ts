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
 * The cap to retry with after a thin result, or null when retrying is not worth it: the
 * call already looked as hard as it is allowed to, or it found a fair share of what it needed.
 */
export function escalatedSearches(previousCap: number, found: number, asked: number) {
  if (previousCap >= MAX_SEARCHES) return null;
  if (asked <= 0) return null;
  if (found / asked >= THIN_YIELD) return null;
  return Math.min(MAX_SEARCHES, Math.max(previousCap + 2, previousCap * 2));
}
