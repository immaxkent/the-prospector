import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Fetch } from "../../src/server/auth/google-oauth";
import { completeGoogleLogin, type LoginDeps } from "../../src/server/auth/login";
import { resolveSession } from "../../src/server/auth/sessions";
import { testDb, truncateAll } from "./helpers";

const handle = testDb();
afterAll(() => handle.close());
beforeEach(() => truncateAll(handle));

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function google(profile: Record<string, unknown>, tokenStatus = 200): Fetch {
  return async (url) =>
    url.includes("/token")
      ? json({ access_token: "at", expires_in: 3600, scope: "openid", token_type: "Bearer" }, tokenStatus)
      : json(profile);
}

const pending = { state: "state-123", verifier: "verifier", returnTo: "/inbox" };
const client = { clientId: "c", clientSecret: "s", redirectUri: "http://localhost/auth/google/callback" };

function deps(fetchImpl: Fetch): LoginDeps {
  return { db: handle.db, client, allowlist: ["max@example.com"], fetchImpl };
}

describe("completeGoogleLogin", () => {
  it("signs in an allowed, verified user and returns to the original page", async () => {
    const result = await completeGoogleLogin(
      deps(google({ sub: "g1", email: "max@example.com", email_verified: true, name: "Max" })),
      { code: "code", state: "state-123", pending, userAgent: "vitest" },
    );
    expect(result).toMatchObject({ ok: true, returnTo: "/inbox", email: "max@example.com" });
    if (!result.ok) throw new Error("expected success");
    await expect(resolveSession(handle.db, result.token)).resolves.toMatchObject({ email: "max@example.com" });
  });

  it("rejects a state that does not match the cookie", async () => {
    const f = google({ sub: "g1", email: "max@example.com", email_verified: true });
    for (const input of [
      { code: "code", state: "other", pending },
      { code: "code", state: "state-123", pending: null },
      { code: null, state: "state-123", pending },
    ]) {
      await expect(completeGoogleLogin(deps(f), input)).resolves.toEqual({ ok: false, reason: "state_mismatch" });
    }
  });

  it("rejects provider failures, unverified emails and addresses off the allowlist", async () => {
    const input = { code: "code", state: "state-123", pending };
    await expect(
      completeGoogleLogin(deps(google({ sub: "g", email: "max@example.com", email_verified: true }, 400)), input),
    ).resolves.toEqual({ ok: false, reason: "provider_error" });
    await expect(
      completeGoogleLogin(deps(google({ sub: "g", email: "max@example.com", email_verified: false })), input),
    ).resolves.toEqual({ ok: false, reason: "email_unverified" });
    await expect(
      completeGoogleLogin(deps(google({ sub: "g", email: "intruder@example.com", email_verified: true })), input),
    ).resolves.toEqual({ ok: false, reason: "not_allowed" });
  });
});
