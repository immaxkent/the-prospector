import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

// Unit tests live next to the code (src/**/*.test.ts[x]).
// Integration tests need Postgres and run through vitest.integration.config.ts.
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    environment: "node",
  },
});
