/**
 * Connecting a Gmail mailbox: a second OAuth flow with Gmail scopes and offline access,
 * available only to a signed-in operator. Redirect URI: <APP_URL>/mailboxes/google/callback
 */
import type { AppConfig } from "../config";
import type { Database } from "../db/client";
import { parseCookies, serializeCookie } from "../auth/http";
import { buildAuthorizationUrl, createPkce, exchangeCode, fetchUserInfo, OAuthError, randomToken, type Fetch } from "../auth/google-oauth";
import { decodePending, encodePending, OAUTH_STATE_TTL_SECONDS } from "../auth/login";
import { resolveSession, SESSION_COOKIE } from "../auth/sessions";
import { CommandError } from "../commands/errors";
import { ALIAS_SCOPES, connectGoogleMailbox, GMAIL_SCOPES } from "../commands/mailboxes";
import { timingSafeEqual } from "node:crypto";

export const MAILBOX_OAUTH_COOKIE = "prospector_mailbox_oauth";

export function mailboxRedirectUri(config: AppConfig) {
  return `${config.appUrl}/mailboxes/google/callback`;
}

function redirect(location: string, cookies: string[] = []) {
  const headers = new Headers({ location, "cache-control": "no-store" });
  for (const c of cookies) headers.append("set-cookie", c);
  return new Response(null, { status: 302, headers });
}

const settingsError = (reason: string) => redirect(`/settings?mailboxError=${encodeURIComponent(reason)}`);

async function signedIn(request: Request, db: Database) {
  return resolveSession(db, parseCookies(request.headers.get("cookie"))[SESSION_COOKIE]);
}

function unavailable(config: AppConfig) {
  if (config.mode !== "live") return "demo_mode";
  if (!config.google) return "google_not_configured";
  if (!config.tokenKey) return "encryption_key_missing";
  return null;
}

export async function handleMailboxConnectStart(request: Request, deps: { config: AppConfig; db: Database }) {
  const problem = unavailable(deps.config);
  if (problem) return settingsError(problem);
  if (!(await signedIn(request, deps.db))) return redirect("/login?returnTo=%2Fsettings");

  const { verifier, challenge } = createPkce();
  const state = randomToken(24);
  // ?alias=1 asks for the extra consent needed to create addresses on the domain.
  const wantsAlias = new URL(request.url).searchParams.get("alias") === "1";
  const scopes = wantsAlias ? [...GMAIL_SCOPES, ...ALIAS_SCOPES] : GMAIL_SCOPES;
  const location = buildAuthorizationUrl(
    { ...deps.config.google!, redirectUri: mailboxRedirectUri(deps.config) },
    { state, codeChallenge: challenge, scopes, offline: true },
  );
  return redirect(location, [
    serializeCookie(MAILBOX_OAUTH_COOKIE, encodePending({ state, verifier, returnTo: "/settings" }), {
      maxAge: OAUTH_STATE_TTL_SECONDS,
      secure: deps.config.appUrl.startsWith("https://"),
    }),
  ]);
}

export async function handleMailboxConnectCallback(
  request: Request,
  deps: { config: AppConfig; db: Database; fetchImpl?: Fetch; now?: () => number },
) {
  const { config, db } = deps;
  const problem = unavailable(config);
  if (problem) return settingsError(problem);
  if (!(await signedIn(request, db))) return redirect("/login?returnTo=%2Fsettings");

  const url = new URL(request.url);
  const clear = serializeCookie(MAILBOX_OAUTH_COOKIE, "", { maxAge: 0, secure: config.appUrl.startsWith("https://") });
  const fail = (reason: string) => {
    const res = settingsError(reason);
    res.headers.append("set-cookie", clear);
    return res;
  };
  if (url.searchParams.get("error")) return fail("access_denied");

  const pending = decodePending(parseCookies(request.headers.get("cookie"))[MAILBOX_OAUTH_COOKIE]);
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  if (!pending || !state || !code || pending.state.length !== state.length || !timingSafeEqual(Buffer.from(pending.state), Buffer.from(state))) {
    return fail("state_mismatch");
  }

  try {
    const client = { ...config.google!, redirectUri: mailboxRedirectUri(config) };
    const tokens = await exchangeCode(client, { code, codeVerifier: pending.verifier }, deps.fetchImpl);
    const profile = await fetchUserInfo(tokens.access_token, deps.fetchImpl);
    if (!profile.email_verified) return fail("email_unverified");
    const now = deps.now?.() ?? Date.now();
    await connectGoogleMailbox(db, config.tokenKey!, {
      address: profile.email,
      displayName: profile.name ?? profile.email,
      tokens: {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt: now + tokens.expires_in * 1000,
        scope: tokens.scope,
      },
    });
    const res = redirect(`/settings?mailbox=${encodeURIComponent(profile.email)}`);
    res.headers.append("set-cookie", clear);
    return res;
  } catch (err) {
    if (err instanceof OAuthError) return fail("provider_error");
    if (err instanceof CommandError) return fail(err.message.includes("Gmail") ? "scopes_missing" : "no_offline_access");
    throw err;
  }
}
