import { sql } from "drizzle-orm";
import { connect, type DatabaseHandle } from "../../src/server/db/client";

export function testDb(): DatabaseHandle {
  const url = process.env["DATABASE_URL"];
  if (!url) throw new Error("DATABASE_URL is not set for integration tests");
  return connect(url, { max: 4 });
}

/** Empties every application table between tests, keeping the migrated schema. */
export async function truncateAll(handle: DatabaseHandle) {
  const rows = await handle.db.execute<{ tablename: string }>(
    sql`select tablename from pg_tables where schemaname = 'public'`,
  );
  const names = rows.map((r) => `"${r.tablename}"`).join(", ");
  if (names) await handle.db.execute(sql.raw(`truncate ${names} restart identity cascade`));
}

export async function countRows(handle: DatabaseHandle) {
  const rows = await handle.db.execute<{ tablename: string }>(
    sql`select tablename from pg_tables where schemaname = 'public'`,
  );
  const counts: Record<string, number> = {};
  for (const { tablename } of rows) {
    const [row] = await handle.db.execute<{ n: number }>(sql.raw(`select count(*)::int as n from "${tablename}"`));
    counts[tablename] = row?.n ?? 0;
  }
  return counts;
}
