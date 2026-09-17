import postgres from "postgres";
import { runMigrations } from "../../src/server/db/migrate";

/** Rebuilds the test database from migrations once per integration run. */
export default async function setup() {
  const url = process.env["DATABASE_URL"];
  if (!url || !url.includes("test")) throw new Error(`refusing to reset a non-test database: ${url}`);
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  await sql.unsafe("drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;");
  await sql.end();
  await runMigrations(url);
}
