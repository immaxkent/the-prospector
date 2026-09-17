/**
 * Google OAuth 2.0 authorization code flow with PKCE.
 * Used for sign-in (openid email profile) and, later, for connecting Gmail mailboxes.
 */
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod/v4";

export const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";

export const SIGN_IN_SCOPES = ["openid", "email", "profile"] as const;

export interface GoogleClient {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

function base64url(buf: Buffer) {
  return buf.toString("base64url");
}

export function randomToken(bytes = 32) {
  return base64url(randomBytes(bytes));
}

export function createPkce() {
  const verifier = randomToken(48);
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

export function buildAuthorizationUrl(
  client: GoogleClient,
  opts: { state: string; codeChallenge: string; scopes: readonly string[]; offline?: boolean; loginHint?: string },
) {
  const url = new URL(GOOGLE_AUTH_URL);
  url.searchParams.set("client_id", client.clientId);
  url.searchParams.set("redirect_uri", client.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", opts.scopes.join(" "));
  url.searchParams.set("state", opts.state);
  url.searchParams.set("code_challenge", opts.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  if (opts.offline) {
    // Refresh tokens are only issued with offline access and an explicit consent prompt.
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
  } else {
    url.searchParams.set("prompt", "select_account");
  }
  if (opts.loginHint) url.searchParams.set("login_hint", opts.loginHint);
  return url.toString();
}

export const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number(),
  refresh_token: z.string().optional(),
  scope: z.string(),
  token_type: z.string(),
  id_token: z.string().optional(),
});

export type TokenResponse = z.infer<typeof tokenResponseSchema>;

export class OAuthError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

export async function exchangeCode(
  client: GoogleClient,
  opts: { code: string; codeVerifier: string },
  fetchImpl: Fetch = fetch,
): Promise<TokenResponse> {
  const res = await fetchImpl(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: opts.code,
      client_id: client.clientId,
      client_secret: client.clientSecret,
      redirect_uri: client.redirectUri,
      grant_type: "authorization_code",
      code_verifier: opts.codeVerifier,
    }).toString(),
  });
  if (!res.ok) throw new OAuthError(`token exchange failed (${res.status})`, res.status);
  const parsed = tokenResponseSchema.safeParse(await res.json());
  if (!parsed.success) throw new OAuthError("token response was malformed");
  return parsed.data;
}

export const userInfoSchema = z.object({
  sub: z.string().min(1),
  email: z.string().min(3),
  email_verified: z.boolean(),
  name: z.string().optional(),
  picture: z.string().optional(),
  hd: z.string().optional(),
});

export type GoogleUserInfo = z.infer<typeof userInfoSchema>;

export async function fetchUserInfo(accessToken: string, fetchImpl: Fetch = fetch): Promise<GoogleUserInfo> {
  const res = await fetchImpl(GOOGLE_USERINFO_URL, { headers: { authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new OAuthError(`userinfo request failed (${res.status})`, res.status);
  const parsed = userInfoSchema.safeParse(await res.json());
  if (!parsed.success) throw new OAuthError("userinfo response was malformed");
  return parsed.data;
}
