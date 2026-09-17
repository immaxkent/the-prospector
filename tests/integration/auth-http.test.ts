import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { handleGoogleCallback, handleGoogleStart, handleLogout, handleTestLogin, parseCookies } from "../../src/server/auth/http";
import { SESSION_COOKIE, resolveSession } from "../../src/server/auth/sessions";
import { loadConfig } from "../../src/server/config";
import { testDb, truncateAll } from "./helpers";

const handle = testDb();
afterAll(() => handle.close());
beforeEach(() => truncateAll(handle));

const config = loadConfig({
  DATABASE_URL: process.env["DATABASE_URL"],
  APP_URL: "http://localhost:4000",
  GOOGLE_CLIENT_ID: "cid",
  GOOGLE_CLIENT_SECRET: "sec",
  AUTH_ALLOWED_EMAILS: "max@example.com",
  AUTH_TEST_LOGIN_SECRET: "e2e-secret",
});

const googleFetch = async (url: string) =>
  new Response(
    JSON.stringify(
      url.includes("/token")
        ? { access_token: "at", expires_in: 3600, scope: "openid", token_type: "Bearer" }
        : { sub: "g1", email: "max@example.com", email_verified: true },
    ),
  );

function cookieFrom(res: Response, name: string) {
  for (const c of res.headers.getSetCookie()) {
    const value = parseCookies(c.split(";")[0]!)[name];
    if (value !== undefined) return value;
  }
  return undefined;
}

describe("sign-in over HTTP", () => {
  it("start → callback → session → logout", async () => {
    const start = handleGoogleStart(new Request("http://localhost:4000/auth/google?returnTo=/pipeline"), config);
    const state = new URL(start.headers.get("location")!).searchParams.get("state")!;
    const pending = cookieFrom(start, "prospector_oauth")!;

    const callback = await handleGoogleCallback(
      new Request(`http://localhost:4000/auth/google/callback?code=abc&state=${state}`, {
        headers: { cookie: `prospector_oauth=${pending}` },
      }),
      { config, db: handle.db, fetchImpl: googleFetch },
    );
    expect(callback.headers.get("location")).toBe("/pipeline");
    const token = cookieFrom(callback, SESSION_COOKIE)!;
    expect(cookieFrom(callback, "prospector_oauth")).toBe("");
    await expect(resolveSession(handle.db, token)).resolves.toMatchObject({ email: "max@example.com" });

    const logout = await handleLogout(
      new Request("http://localhost:4000/auth/logout", { method: "POST", headers: { cookie: `${SESSION_COOKIE}=${token}` } }),
      { config, db: handle.db },
    );
    expect(logout.headers.get("location")).toBe("/login");
    await expect(resolveSession(handle.db, token)).resolves.toBeNull();
  });

  it("a callback without the state cookie is refused", async () => {
    const res = await handleGoogleCallback(new Request("http://localhost:4000/auth/google/callback?code=abc&state=forged"), {
      config,
      db: handle.db,
      fetchImpl: googleFetch,
    });
    expect(res.headers.get("location")).toBe("/login?error=state_mismatch");
    expect(cookieFrom(res, SESSION_COOKIE)).toBeUndefined();
  });

  it("test login signs in allowlisted emails only", async () => {
    const ok = await handleTestLogin(
      new Request("http://localhost:4000/auth/test-login?secret=e2e-secret&email=max@example.com&returnTo=/inbox"),
      { config, db: handle.db },
    );
    expect(ok.headers.get("location")).toBe("/inbox");
    await expect(resolveSession(handle.db, cookieFrom(ok, SESSION_COOKIE))).resolves.not.toBeNull();

    const denied = await handleTestLogin(
      new Request("http://localhost:4000/auth/test-login?secret=e2e-secret&email=intruder@example.com"),
      { config, db: handle.db },
    );
    expect(denied.headers.get("location")).toBe("/login?error=not_allowed");
  });
});
