import { timingSafeEqual } from "node:crypto";
import type { Database } from "../db/client";
import { isAllowed } from "./allowlist";
import { OAuthError, exchangeCode, fetchUserInfo, type Fetch, type GoogleClient } from "./google-oauth";
import { createSession, upsertUser } from "./sessions";

export const OAUTH_STATE_COOKIE = "prospector_oauth";
export const OAUTH_STATE_TTL_SECONDS = 600;

/** The pending sign-in, kept in a short-lived httpOnly cookie between redirect and callback. */
export interface PendingLogin {
  state: string;
  verifier: string;
  returnTo: string;
}

export function encodePending(p: PendingLogin) {
  return Buffer.from(JSON.stringify(p)).toString("base64url");
}

export function decodePending(raw: string | undefined): PendingLogin | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Partial<PendingLogin>;
    if (typeof v.state !== "string" || typeof v.verifier !== "string" || typeof v.returnTo !== "string") return null;
    return { state: v.state, verifier: v.verifier, returnTo: safeReturnTo(v.returnTo) };
  } catch {
    return null;
  }
}

/** Only same-origin paths; anything else returns to the home screen. */
export function safeReturnTo(value: string | null | undefined) {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return "/";
  return value;
}

function sameString(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export type LoginFailure = "state_mismatch" | "provider_error" | "email_unverified" | "not_allowed";

export type LoginResult =
  | { ok: true; token: string; expiresAt: Date; returnTo: string; email: string }
  | { ok: false; reason: LoginFailure };

export interface LoginDeps {
  db: Database;
  client: GoogleClient;
  allowlist: readonly string[];
  fetchImpl?: Fetch;
}

export async function completeGoogleLogin(
  deps: LoginDeps,
  input: { code: string | null; state: string | null; pending: PendingLogin | null; userAgent?: string | null },
): Promise<LoginResult> {
  const { pending } = input;
  if (!pending || !input.state || !input.code || !sameString(pending.state, input.state)) {
    return { ok: false, reason: "state_mismatch" };
  }

  let profile;
  try {
    const tokens = await exchangeCode(deps.client, { code: input.code, codeVerifier: pending.verifier }, deps.fetchImpl);
    profile = await fetchUserInfo(tokens.access_token, deps.fetchImpl);
  } catch (err) {
    if (err instanceof OAuthError) return { ok: false, reason: "provider_error" };
    throw err;
  }

  if (!profile.email_verified) return { ok: false, reason: "email_unverified" };
  if (!isAllowed(profile.email, deps.allowlist)) return { ok: false, reason: "not_allowed" };

  const user = await upsertUser(deps.db, { email: profile.email, name: profile.name, googleSub: profile.sub });
  const session = await createSession(deps.db, user.id, { userAgent: input.userAgent ?? null });
  return { ok: true, token: session.token, expiresAt: session.expiresAt, returnTo: pending.returnTo, email: user.email };
}
