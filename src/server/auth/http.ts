/**
 * Auth endpoints as plain Request → Response handlers. Route files only wire these up.
 */
import type { AppConfig } from "../config";
import { googleRedirectUri } from "../config";
import type { Database } from "../db/client";
import { isAllowed } from "./allowlist";
import { SIGN_IN_SCOPES, buildAuthorizationUrl, createPkce, randomToken, type Fetch } from "./google-oauth";
import {
  OAUTH_STATE_COOKIE,
  OAUTH_STATE_TTL_SECONDS,
  completeGoogleLogin,
  decodePending,
  encodePending,
  safeReturnTo,
} from "./login";
import { SESSION_COOKIE, createSession, revokeSession, upsertUser } from "./sessions";

export function parseCookies(header: string | null) {
  const out: Record<string, string> = {};
  for (const part of (header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const name = part.slice(0, i).trim();
    if (name) out[name] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function serializeCookie(
  name: string,
  value: string,
  opts: { maxAge?: number; expires?: Date; secure: boolean; path?: string },
) {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${opts.path ?? "/"}`, "HttpOnly", "SameSite=Lax"];
  if (opts.secure) parts.push("Secure");
  if (opts.maxAge !== undefined) parts.push(`Max-Age=${opts.maxAge}`);
  if (opts.expires) parts.push(`Expires=${opts.expires.toUTCString()}`);
  return parts.join("; ");
}

const isSecure = (config: AppConfig) => config.appUrl.startsWith("https://");

function redirect(location: string, cookies: string[] = []) {
  const headers = new Headers({ location, "cache-control": "no-store" });
  for (const c of cookies) headers.append("set-cookie", c);
  return new Response(null, { status: 302, headers });
}

function loginError(reason: string) {
  return redirect(`/login?error=${encodeURIComponent(reason)}`);
}

export function handleGoogleStart(request: Request, config: AppConfig) {
  if (config.mode !== "live" || !config.google) return loginError("google_not_configured");
  const url = new URL(request.url);
  const { verifier, challenge } = createPkce();
  const state = randomToken(24);
  const pending = { state, verifier, returnTo: safeReturnTo(url.searchParams.get("returnTo")) };
  const location = buildAuthorizationUrl(
    { ...config.google, redirectUri: googleRedirectUri(config) },
    { state, codeChallenge: challenge, scopes: SIGN_IN_SCOPES },
  );
  return redirect(location, [
    serializeCookie(OAUTH_STATE_COOKIE, encodePending(pending), {
      maxAge: OAUTH_STATE_TTL_SECONDS,
      secure: isSecure(config),
    }),
  ]);
}

export async function handleGoogleCallback(
  request: Request,
  deps: { config: AppConfig; db: Database; fetchImpl?: Fetch },
) {
  const { config } = deps;
  if (config.mode !== "live" || !config.google) return loginError("google_not_configured");
  const url = new URL(request.url);
  if (url.searchParams.get("error")) return loginError("access_denied");
  const cookies = parseCookies(request.headers.get("cookie"));
  const result = await completeGoogleLogin(
    {
      db: deps.db,
      client: { ...config.google, redirectUri: googleRedirectUri(config) },
      allowlist: config.allowlist,
      ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
    },
    {
      code: url.searchParams.get("code"),
      state: url.searchParams.get("state"),
      pending: decodePending(cookies[OAUTH_STATE_COOKIE]),
      userAgent: request.headers.get("user-agent"),
    },
  );
  const clearPending = serializeCookie(OAUTH_STATE_COOKIE, "", { maxAge: 0, secure: isSecure(config) });
  if (!result.ok) {
    const res = loginError(result.reason);
    res.headers.append("set-cookie", clearPending);
    return res;
  }
  return redirect(result.returnTo, [
    clearPending,
    serializeCookie(SESSION_COOKIE, result.token, { expires: result.expiresAt, secure: isSecure(config) }),
  ]);
}

export async function handleLogout(request: Request, deps: { config: AppConfig; db: Database }) {
  if (request.method !== "POST") return new Response("method not allowed", { status: 405, headers: { allow: "POST" } });
  const token = parseCookies(request.headers.get("cookie"))[SESSION_COOKIE];
  if (deps.config.mode === "live") await revokeSession(deps.db, token);
  return redirect("/login", [serializeCookie(SESSION_COOKIE, "", { maxAge: 0, secure: isSecure(deps.config) })]);
}

/** E2E only: signs in an allowlisted email without Google. Disabled unless a secret is configured outside production. */
export async function handleTestLogin(request: Request, deps: { config: AppConfig; db: Database }) {
  const { config } = deps;
  if (config.production || !config.testLoginSecret || config.mode !== "live") {
    return new Response("not found", { status: 404 });
  }
  const url = new URL(request.url);
  if (url.searchParams.get("secret") !== config.testLoginSecret) return new Response("forbidden", { status: 403 });
  const email = url.searchParams.get("email") ?? "";
  if (!isAllowed(email, config.allowlist)) return loginError("not_allowed");
  const user = await upsertUser(deps.db, { email });
  const session = await createSession(deps.db, user.id, { userAgent: request.headers.get("user-agent") });
  return redirect(safeReturnTo(url.searchParams.get("returnTo")), [
    serializeCookie(SESSION_COOKIE, session.token, { expires: session.expiresAt, secure: isSecure(config) }),
  ]);
}
