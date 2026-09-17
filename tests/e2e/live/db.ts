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

/**
 * Full reset between specs, in dependency order: an endeavour pins its mailbox
 * (delete is restricted), so real endeavours go first, then fixtures, then the rest.
 */
export async function resetDatabase() {
  await query("delete from jobs");
  await query("delete from endeavours where is_fixture = false");
  dbScript("purge-fixtures");
  await query("delete from mailboxes where is_fixture = false");
  await query("delete from intake_sessions");
  await query("delete from suppressions");
}
