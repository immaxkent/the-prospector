import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  GOOGLE_TOKEN_URL,
  OAuthError,
  SIGN_IN_SCOPES,
  buildAuthorizationUrl,
  createPkce,
  exchangeCode,
  fetchUserInfo,
  type Fetch,
} from "./google-oauth";

const client = { clientId: "cid", clientSecret: "secret", redirectUri: "https://app.example/auth/google/callback" };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("pkce", () => {
  it("derives an S256 challenge from a high-entropy verifier", () => {
    const { verifier, challenge } = createPkce();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(challenge).toBe(createHash("sha256").update(verifier).digest("base64url"));
    expect(createPkce().verifier).not.toBe(verifier);
  });
});

describe("buildAuthorizationUrl", () => {
  it("builds a sign-in url with state and PKCE", () => {
    const url = new URL(buildAuthorizationUrl(client, { state: "st", codeChallenge: "ch", scopes: SIGN_IN_SCOPES }));
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: "cid",
      redirect_uri: client.redirectUri,
      response_type: "code",
      scope: "openid email profile",
      state: "st",
      code_challenge: "ch",
      code_challenge_method: "S256",
      prompt: "select_account",
    });
  });

  it("asks for offline access and consent when a refresh token is needed", () => {
    const url = new URL(
      buildAuthorizationUrl(client, { state: "s", codeChallenge: "c", scopes: ["x"], offline: true, loginHint: "a@b.c" }),
    );
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("login_hint")).toBe("a@b.c");
  });
});

describe("exchangeCode", () => {
  it("posts the code and verifier and parses the tokens", async () => {
    const fetchImpl = vi.fn<Fetch>(async () =>
      json({ access_token: "at", expires_in: 3599, scope: "openid", token_type: "Bearer", refresh_token: "rt" }),
    );
    const tokens = await exchangeCode(client, { code: "code1", codeVerifier: "ver1" }, fetchImpl);
    expect(tokens.refresh_token).toBe("rt");
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe(GOOGLE_TOKEN_URL);
    const body = new URLSearchParams(init!.body as string);
    expect(body.get("code")).toBe("code1");
    expect(body.get("code_verifier")).toBe("ver1");
    expect(body.get("grant_type")).toBe("authorization_code");
  });

  it("throws on an error status or a malformed body", async () => {
    await expect(exchangeCode(client, { code: "c", codeVerifier: "v" }, async () => json({}, 400))).rejects.toThrow(
      OAuthError,
    );
    await expect(
      exchangeCode(client, { code: "c", codeVerifier: "v" }, async () => json({ nope: true })),
    ).rejects.toThrow("malformed");
  });
});

describe("fetchUserInfo", () => {
  it("sends the bearer token and parses the profile", async () => {
    const fetchImpl = vi.fn<Fetch>(async () => json({ sub: "1", email: "max@example.com", email_verified: true }));
    await expect(fetchUserInfo("at", fetchImpl)).resolves.toMatchObject({ email: "max@example.com" });
    expect((fetchImpl.mock.calls[0]![1]!.headers as Record<string, string>)["authorization"]).toBe("Bearer at");
  });

  it("rejects profiles without a verified flag", async () => {
    await expect(fetchUserInfo("at", async () => json({ sub: "1", email: "x@y.z" }))).rejects.toThrow("malformed");
  });
});
