import { describe, expect, it } from "vitest";
import { loadConfig } from "../config";
import type { Database } from "../db/client";
import { handleGoogleStart, handleLogout, handleTestLogin, parseCookies, serializeCookie } from "./http";
import { OAUTH_STATE_COOKIE, decodePending } from "./login";

const live = loadConfig({
  DATABASE_URL: "postgres://unused",
  APP_URL: "https://prospector.example",
  GOOGLE_CLIENT_ID: "cid",
  GOOGLE_CLIENT_SECRET: "sec",
  AUTH_ALLOWED_EMAILS: "max@example.com",
});
const noDb = {} as Database;

describe("cookies", () => {
  it("parse a cookie header", () => {
    expect(parseCookies("a=1; b=hello%20world; malformed")).toEqual({ a: "1", b: "hello world" });
    expect(parseCookies(null)).toEqual({});
  });

  it("serialize httpOnly, lax and secure when asked", () => {
    expect(serializeCookie("s", "v", { maxAge: 10, secure: true })).toBe(
      "s=v; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=10",
    );
    expect(serializeCookie("s", "", { maxAge: 0, secure: false })).not.toContain("Secure");
  });
});

describe("handleGoogleStart", () => {
  it("redirects to Google and stores state, verifier and a safe return path", () => {
    const res = handleGoogleStart(new Request("https://prospector.example/auth/google?returnTo=/inbox"), live);
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get("location")!);
    expect(location.hostname).toBe("accounts.google.com");
    expect(location.searchParams.get("redirect_uri")).toBe("https://prospector.example/auth/google/callback");

    const cookie = res.headers.get("set-cookie")!;
    expect(cookie).toContain("Secure");
    const pending = decodePending(parseCookies(cookie.split(";")[0]!)[OAUTH_STATE_COOKIE]);
    expect(pending).toMatchObject({ state: location.searchParams.get("state"), returnTo: "/inbox" });
  });

  it("refuses when Google or the database is not configured", () => {
    const res = handleGoogleStart(new Request("http://localhost/auth/google"), loadConfig({}));
    expect(res.headers.get("location")).toBe("/login?error=google_not_configured");
  });
});

describe("handleLogout", () => {
  it("only accepts POST", async () => {
    const res = await handleLogout(new Request("http://localhost/auth/logout"), { config: live, db: noDb });
    expect(res.status).toBe(405);
  });
});

describe("handleTestLogin", () => {
  it("does not exist without a secret", async () => {
    const res = await handleTestLogin(new Request("http://localhost/auth/test-login?secret=x"), { config: live, db: noDb });
    expect(res.status).toBe(404);
  });

  it("rejects a wrong secret", async () => {
    const config = { ...live, testLoginSecret: "right" };
    const res = await handleTestLogin(new Request("http://localhost/auth/test-login?secret=wrong"), { config, db: noDb });
    expect(res.status).toBe(403);
  });

  it("does not exist in production even if a secret slipped through", async () => {
    const config = { ...live, testLoginSecret: "right", production: true };
    const res = await handleTestLogin(new Request("http://localhost/auth/test-login?secret=right"), { config, db: noDb });
    expect(res.status).toBe(404);
  });
});
