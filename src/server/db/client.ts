import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type Database = PostgresJsDatabase<typeof schema>;

export interface DatabaseHandle {
  db: Database;
  close: () => Promise<void>;
}

export function connect(url: string, opts: { max?: number } = {}): DatabaseHandle {
  const sql = postgres(url, { max: opts.max ?? 10, onnotice: () => {} });
  return { db: drizzle(sql, { schema }), close: () => sql.end({ timeout: 5 }) };
}

let shared: DatabaseHandle | undefined;

/** Process-wide connection from DATABASE_URL. Web and worker processes each get one pool. */
export function getDb(): Database {
  if (!shared) {
    const url = process.env["DATABASE_URL"];
    if (!url) throw new Error("DATABASE_URL is not set");
    shared = connect(url);
  }
  return shared.db;
}

export async function closeDb() {
  await shared?.close();
  shared = undefined;
}
