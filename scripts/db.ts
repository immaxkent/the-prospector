/**
 * Database operations: migrate | seed-fixtures | purge-fixtures
 * Usage: tsx scripts/db.ts <command>   (reads DATABASE_URL)
 */
import { connect } from "../src/server/db/client";
import { purgeFixtures, seedFixtures } from "../src/server/db/fixtures";
import { runMigrations } from "../src/server/db/migrate";

const COMMANDS = ["migrate", "seed-fixtures", "purge-fixtures"] as const;
type Command = (typeof COMMANDS)[number];

async function main(command: Command, url: string) {
  if (command === "migrate") {
    await runMigrations(url);
    return "migrations applied";
  }
  if (process.env["NODE_ENV"] === "production" && command === "seed-fixtures") {
    throw new Error("fixtures are never seeded in production");
  }
  const handle = connect(url, { max: 1 });
  try {
    if (command === "seed-fixtures") await seedFixtures(handle.db);
    else await purgeFixtures(handle.db);
  } finally {
    await handle.close();
  }
  return command === "seed-fixtures" ? "fixtures seeded" : "fixtures purged";
}

const command = process.argv[2] as Command | undefined;
const url = process.env["DATABASE_URL"];
if (!command || !COMMANDS.includes(command)) {
  console.error(`usage: tsx scripts/db.ts <${COMMANDS.join("|")}>`);
  process.exit(2);
}
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(2);
}
main(command, url).then(
  (msg) => console.log(msg),
  (err: unknown) => {
    console.error(err);
    process.exit(1);
  },
);
