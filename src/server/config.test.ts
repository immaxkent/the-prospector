import { describe, expect, it } from "vitest";
import { ConfigError, googleRedirectUri, loadConfig } from "./config";

const prod = {
  APP_ENV: "production",
  APP_URL: "https://prospector.example/",
  DATABASE_URL: "postgres://x",
  GOOGLE_CLIENT_ID: "id",
  GOOGLE_CLIENT_SECRET: "secret",
  AUTH_ALLOWED_EMAILS: "max@example.com",
};

describe("loadConfig", () => {
  it("runs in demo mode without a database", () => {
    const c = loadConfig({});
    expect(c).toMatchObject({ mode: "demo", production: false, appUrl: "http://localhost:3000", google: null, model: "claude-sonnet-5" });
    expect(loadConfig({ ANTHROPIC_MODEL: "claude-opus-5" }).model).toBe("claude-opus-5");
  });

  it("runs live with a database and trims the app url", () => {
    const c = loadConfig({ DATABASE_URL: "postgres://x", APP_URL: "http://localhost:4000/" });
    expect(c.mode).toBe("live");
    expect(googleRedirectUri(c)).toBe("http://localhost:4000/auth/google/callback");
  });

  it("accepts a complete production config", () => {
    expect(loadConfig(prod)).toMatchObject({ mode: "live", production: true, allowlist: ["max@example.com"] });
  });

  it("refuses production without a database, google, allowlist or https", () => {
    expect(() => loadConfig({ APP_ENV: "production" })).toThrow(ConfigError);
    try {
      loadConfig({ APP_ENV: "production", APP_URL: "http://x" });
    } catch (e) {
      const msg = (e as Error).message;
      for (const part of ["DATABASE_URL", "GOOGLE_CLIENT_ID", "AUTH_ALLOWED_EMAILS", "https"]) expect(msg).toContain(part);
    }
  });

  it("refuses the test login in production", () => {
    expect(() => loadConfig({ ...prod, AUTH_TEST_LOGIN_SECRET: "s" })).toThrow("AUTH_TEST_LOGIN_SECRET");
  });
});
