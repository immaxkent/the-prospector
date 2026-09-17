import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

const TEST_DATABASE_URL =
  process.env["TEST_DATABASE_URL"] ?? "postgres://prospector:prospector@localhost:55433/prospector_test";

// Global setup runs in this process, so the test database must be set here, overriding any dev DATABASE_URL.
process.env["DATABASE_URL"] = TEST_DATABASE_URL;

// Integration tests hit a real Postgres (docker compose up -d).
// They share one database, so files run one at a time.
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    include: ["tests/integration/**/*.test.ts"],
    environment: "node",
    fileParallelism: false,
    globalSetup: ["tests/integration/global-setup.ts"],
    env: { DATABASE_URL: TEST_DATABASE_URL },
  },
});
