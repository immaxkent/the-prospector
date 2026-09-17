import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

// Integration tests hit a real Postgres (docker compose up -d).
// They share one database, so files run one at a time.
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    include: ["tests/integration/**/*.test.ts"],
    environment: "node",
    fileParallelism: false,
    env: {
      DATABASE_URL:
        process.env["TEST_DATABASE_URL"] ?? "postgres://prospector:prospector@localhost:55433/prospector_test",
    },
  },
});
