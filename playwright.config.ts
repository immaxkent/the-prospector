import { defineConfig, devices } from "@playwright/test";
import { E2E_LOGIN_SECRET, E2E_OPERATOR } from "./tests/e2e/live/env";

// E2E runs against the production Node build (npm run test:e2e builds first),
// the same artifact that ships to the box. Two servers:
// - demo: no database, design fixtures, no sign-in
// - live: e2e database, sign-in required, guarded test login enabled
const DEMO_PORT = Number(process.env["E2E_DEMO_PORT"] ?? 4310);
const LIVE_PORT = Number(process.env["E2E_LIVE_PORT"] ?? 4320);
const E2E_DATABASE_URL =
  process.env["E2E_DATABASE_URL"] ?? "postgres://prospector:prospector@localhost:55433/prospector_e2e";
const CI = !!process.env["CI"];

export default defineConfig({
  testDir: "tests/e2e",
  // Live specs share one database, so specs run one at a time. The whole suite still takes seconds.
  workers: 1,
  retries: CI ? 1 : 0,
  reporter: CI ? "github" : "list",
  use: {
    trace: "retain-on-failure",
    // The WebGL backdrop only mounts without reduced motion. Under software rendering
    // it starves parallel workers, so screens are tested without it.
    reducedMotion: "reduce",
  },
  projects: [
    {
      name: "demo",
      testMatch: "demo/**/*.spec.ts",
      use: { ...devices["Desktop Chrome"], baseURL: `http://localhost:${DEMO_PORT}` },
    },
    {
      name: "live",
      testMatch: "live/**/*.spec.ts",
      use: { ...devices["Desktop Chrome"], baseURL: `http://localhost:${LIVE_PORT}` },
    },
  ],
  webServer: [
    {
      command: `PORT=${DEMO_PORT} node .output/server/index.mjs`,
      url: `http://localhost:${DEMO_PORT}/login`,
      reuseExistingServer: !CI,
      env: { DATABASE_URL: "" },
    },
    {
      command: `tsx scripts/e2e-db.ts && PORT=${LIVE_PORT} node .output/server/index.mjs`,
      url: `http://localhost:${LIVE_PORT}/login`,
      reuseExistingServer: !CI,
      timeout: 60_000,
      env: {
        E2E_DATABASE_URL,
        DATABASE_URL: E2E_DATABASE_URL,
        APP_URL: `http://localhost:${LIVE_PORT}`,
        AUTH_ALLOWED_EMAILS: E2E_OPERATOR,
        AUTH_TEST_LOGIN_SECRET: E2E_LOGIN_SECRET,
        // The planner answers from a fixture, so e2e never calls Claude.
        INTAKE_PLANNER_FIXTURE: "1",
      },
    },
  ],
});
