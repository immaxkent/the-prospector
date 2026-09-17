/**
 * Server functions and middleware the UI calls for auth state.
 * Server-only modules are imported inside handlers so they never reach the client bundle.
 */
import { createMiddleware, createServerFn } from "@tanstack/react-start";
import type { SessionUser } from "../server/auth/sessions";

export interface SessionState {
  mode: "live" | "demo";
  user: SessionUser | null;
}

async function loadSession(): Promise<SessionState> {
  const [{ getConfig }, { getCookie }] = await Promise.all([
    import("../server/config"),
    import("@tanstack/react-start/server"),
  ]);
  const config = getConfig();
  if (config.mode === "demo") return { mode: "demo", user: null };
  const [{ getDb }, { SESSION_COOKIE, resolveSession }] = await Promise.all([import("../server/db/client"), import("../server/auth/sessions")]);
  return { mode: "live", user: await resolveSession(getDb(), getCookie(SESSION_COOKIE)) };
}

export const fetchSession = createServerFn({ method: "GET" }).handler(loadSession);

export class UnauthorizedError extends Error {
  readonly statusCode = 401;
  constructor() {
    super("sign-in required");
  }
}

/** Attach to every server function that reads or writes operator data. Demo mode has no user. */
export const requireSession = createMiddleware({ type: "function" }).server(async ({ next }) => {
  const session = await loadSession();
  if (session.mode === "live" && !session.user) throw new UnauthorizedError();
  return next({ context: { session } });
});
