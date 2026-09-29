import { queryOptions } from "@tanstack/react-query";
import { fetchDataset } from "@/api/dataset";
import { fetchSession } from "@/api/session";

/** Everything the screens read in live mode. Mutations invalidate this key. */
export const datasetQuery = queryOptions({
  queryKey: ["dataset"] as const,
  queryFn: () => fetchDataset(),
});

/**
 * Long enough that clicking through the app does not ask the server who you are on every
 * click, short enough that signing out elsewhere is noticed within the minute.
 *
 * This is the whole reason the constant exists: the root route awaits the session before
 * any screen renders, so an uncached read put a network round-trip in front of every
 * navigation. Measured at ~115ms on the production box — long enough to read as the page
 * flashing and then loading a second time.
 */
export const SESSION_STALE_MS = 30_000;

/**
 * Who is signed in.
 *
 * Cached, and safe to cache: this decides whether to *show* a screen, never whether to
 * serve data. Every server function that touches operator data goes through
 * `requireSession`, which reads the cookie itself on every call. A stale answer here can
 * at worst render a screen whose data then comes back 401 — it cannot hand anything out.
 */
export const sessionQuery = queryOptions({
  queryKey: ["session"] as const,
  queryFn: () => fetchSession(),
  staleTime: SESSION_STALE_MS,
});
