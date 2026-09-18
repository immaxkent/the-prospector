/**
 * Runtime configuration from the environment.
 *
 * Modes:
 * - live: DATABASE_URL is set. Sign-in is required and screens read the database.
 * - demo: no DATABASE_URL (Lovable preview, design work). Design fixtures, no sign-in.
 * Production (APP_ENV=production) must be live and must not enable the test login.
 */
import { parseAllowlist } from "./auth/allowlist";
import { TokenKeyError, parseKey } from "./crypto/tokens";

export type AppMode = "live" | "demo";

export class ConfigError extends Error {}

export interface AppConfig {
  mode: AppMode;
  production: boolean;
  appUrl: string;
  databaseUrl: string | null;
  google: { clientId: string; clientSecret: string } | null;
  allowlist: string[];
  /** Encrypts stored OAuth tokens. Null when unset or invalid; mailbox connection is then unavailable. */
  tokenKey: Buffer | null;
  /** Claude model used by the agent roles. */
  model: string;
  /** Phone push through ntfy, when set. */
  notifyNtfyUrl: string | null;
  /** Any endpoint that accepts a JSON POST, when set. */
  notifyWebhookUrl: string | null;
  /** Keys that may call /api/v1. Empty means the API is closed. */
  apiKeys: string[];
  /** Hour (operator timezone) after which the day's runs are queued. */
  dailyRunHour: number;
  /** "external" runs the worker as its own process; "inline" drains the queue inside the web process (dev and e2e only). */
  workerMode: "external" | "inline";
  /** Anthropic key for the agent roles. Null means the planner and daily run are unavailable. */
  anthropicApiKey: string | null;
  /** Answers the planner from a fixture instead of calling Claude. E2E only, never in production. */
  plannerFixture: boolean;
  /** Enables /auth/test-login for e2e. Never set in production. */
  testLoginSecret: string | null;
}

type Env = Record<string, string | undefined>;

export function loadConfig(env: Env = process.env): AppConfig {
  const production = env["APP_ENV"] === "production";
  const databaseUrl = env["DATABASE_URL"] || null;
  const appUrl = (env["APP_URL"] || "http://localhost:3000").replace(/\/+$/, "");
  const clientId = env["GOOGLE_CLIENT_ID"];
  const clientSecret = env["GOOGLE_CLIENT_SECRET"];
  const testLoginSecret = env["AUTH_TEST_LOGIN_SECRET"] || null;

  const config: AppConfig = {
    mode: databaseUrl ? "live" : "demo",
    production,
    appUrl,
    databaseUrl,
    google: clientId && clientSecret ? { clientId, clientSecret } : null,
    allowlist: parseAllowlist(env["AUTH_ALLOWED_EMAILS"]),
    tokenKey: null,
    notifyNtfyUrl: env["NOTIFY_NTFY_URL"] || null,
    notifyWebhookUrl: env["NOTIFY_WEBHOOK_URL"] || null,
    apiKeys: (env["API_KEYS"] ?? "").split(",").map((k) => k.trim()).filter((k) => k.length >= 16),
    dailyRunHour: Number(env["DAILY_RUN_HOUR"] ?? 7),
    workerMode: env["WORKER_MODE"] === "inline" ? "inline" : "external",
    anthropicApiKey: env["ANTHROPIC_API_KEY"] || null,
    plannerFixture: env["INTAKE_PLANNER_FIXTURE"] === "1",
    model: env["ANTHROPIC_MODEL"] || "claude-opus-5",
    testLoginSecret,
  };

  let tokenKeyProblem: string | null = null;
  try {
    config.tokenKey = parseKey(env["TOKEN_ENCRYPTION_KEY"]);
  } catch (err) {
    if (!(err instanceof TokenKeyError)) throw err;
    tokenKeyProblem = err.message;
  }

  if (!Number.isInteger(config.dailyRunHour) || config.dailyRunHour < 0 || config.dailyRunHour > 23) {
    config.dailyRunHour = 7;
  }

  if (production) {
    const problems: string[] = [];
    if (tokenKeyProblem) problems.push(tokenKeyProblem);
    if (!databaseUrl) problems.push("DATABASE_URL is required");
    if (!config.google) problems.push("GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are required");
    if (config.allowlist.length === 0) problems.push("AUTH_ALLOWED_EMAILS must list at least one address");
    if (testLoginSecret) problems.push("AUTH_TEST_LOGIN_SECRET must not be set");
    if (config.plannerFixture) problems.push("INTAKE_PLANNER_FIXTURE must not be set");
    if (config.workerMode === "inline") problems.push("WORKER_MODE=inline is for development only");
    if (!config.anthropicApiKey) problems.push("ANTHROPIC_API_KEY is required");
    if (!appUrl.startsWith("https://")) problems.push("APP_URL must be https");
    if (problems.length) throw new ConfigError(`invalid production config: ${problems.join("; ")}`);
  }
  return config;
}

let cached: AppConfig | undefined;

export function getConfig() {
  cached ??= loadConfig();
  return cached;
}

export function googleRedirectUri(config: AppConfig) {
  return `${config.appUrl}/auth/google/callback`;
}
