import { execFileSync } from "node:child_process";
import postgres from "postgres";

export const E2E_DATABASE_URL =
  process.env["E2E_DATABASE_URL"] ?? "postgres://prospector:prospector@localhost:55433/prospector_e2e";

export function dbScript(command: "seed-fixtures" | "purge-fixtures") {
  execFileSync("npx", ["tsx", "scripts/db.ts", command], {
    env: { ...process.env, DATABASE_URL: E2E_DATABASE_URL },
    stdio: "pipe",
  });
}

/** Runs one query against the e2e database, for asserting what the UI wrote. */
export async function query<T extends Record<string, unknown>>(text: string, params: (string | number)[] = []) {
  const sql = postgres(E2E_DATABASE_URL, { max: 1, onnotice: () => {} });
  try {
    return (await sql.unsafe(text, params)) as unknown as T[];
  } finally {
    await sql.end();
  }
}
