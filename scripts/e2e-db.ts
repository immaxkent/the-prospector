/**
 * Prepares a clean, migrated database for live-mode e2e runs.
 * Creates the database if missing, wipes its schema and applies migrations.
 */
import postgres from "postgres";
import { runMigrations } from "../src/server/db/migrate";

const url = process.env["E2E_DATABASE_URL"] ?? "postgres://prospector:prospector@localhost:55433/prospector_e2e";

async function main() {
  const target = new URL(url);
  const dbName = target.pathname.slice(1);
  if (!dbName.includes("e2e")) throw new Error(`refusing to reset a non-e2e database: ${dbName}`);

  const admin = new URL(url);
  admin.pathname = "/postgres";
  const adminSql = postgres(admin.toString(), { max: 1, onnotice: () => {} });
  const exists = await adminSql`select 1 from pg_database where datname = ${dbName}`;
  if (exists.length === 0) await adminSql.unsafe(`create database "${dbName}"`);
  await adminSql.end();

  const sql = postgres(url, { max: 1, onnotice: () => {} });
  await sql.unsafe("drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;");
  await sql.end();
  await runMigrations(url);
  console.log(`e2e database ready: ${dbName}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
