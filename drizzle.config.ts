import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/server/db/schema.ts",
  out: "./db/migrations",
  dbCredentials: {
    url: process.env["DATABASE_URL"] ?? "postgres://prospector:prospector@localhost:55433/prospector",
  },
  strict: true,
});
