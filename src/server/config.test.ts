import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ConfigError, googleRedirectUri, loadConfig } from "./config";

const prod = {
  APP_ENV: "production",
  APP_URL: "https://prospector.example/",
  DATABASE_URL: "postgres://x",
  GOOGLE_CLIENT_ID: "id",
  GOOGLE_CLIENT_SECRET: "secret",
  AUTH_ALLOWED_EMAILS: "max@example.com",
  TOKEN_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
  ANTHROPIC_API_KEY: "sk-ant-test",
};

describe("loadConfig", () => {
  it("runs in demo mode without a database", () => {
    const c = loadConfig({});
    expect(c).toMatchObject({ mode: "demo", production: false, appUrl: "http://localhost:3000", google: null, model: "claude-opus-5" });
    expect(loadConfig({ ANTHROPIC_MODEL: "claude-sonnet-5" }).model).toBe("claude-sonnet-5");
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

  it("parses the token key and requires it in production", () => {
    expect(loadConfig({}).tokenKey).toBeNull();
    expect(loadConfig(prod).tokenKey).toHaveLength(32);
    expect(() => loadConfig({ ...prod, TOKEN_ENCRYPTION_KEY: "short" })).toThrow("TOKEN_ENCRYPTION_KEY");
  });

  it("accepts only long enough API keys", () => {
    expect(loadConfig({}).apiKeys).toEqual([]);
    expect(loadConfig({ API_KEYS: "short, a-key-long-enough-to-use , another-key-long-enough" }).apiKeys).toEqual([
      "a-key-long-enough-to-use",
      "another-key-long-enough",
    ]);
  });

  it("reads the daily run hour and worker mode, and guards them", () => {
    expect(loadConfig({})).toMatchObject({ dailyRunHour: 7, workerMode: "external" });
    expect(loadConfig({ DAILY_RUN_HOUR: "6", WORKER_MODE: "inline" })).toMatchObject({ dailyRunHour: 6, workerMode: "inline" });
    expect(loadConfig({ DAILY_RUN_HOUR: "25" }).dailyRunHour).toBe(7);
    expect(() => loadConfig({ ...prod, WORKER_MODE: "inline" })).toThrow("development only");
  });

  it("requires a Claude key in production and refuses the fixture planner there", () => {
    expect(loadConfig({}).plannerFixture).toBe(false);
    expect(loadConfig({ INTAKE_PLANNER_FIXTURE: "1" }).plannerFixture).toBe(true);
    expect(() => loadConfig({ ...prod, ANTHROPIC_API_KEY: "" })).toThrow("ANTHROPIC_API_KEY");
    expect(() => loadConfig({ ...prod, INTAKE_PLANNER_FIXTURE: "1" })).toThrow("INTAKE_PLANNER_FIXTURE");
  });

  it("refuses the test login in production", () => {
    expect(() => loadConfig({ ...prod, AUTH_TEST_LOGIN_SECRET: "s" })).toThrow("AUTH_TEST_LOGIN_SECRET");
  });
});
