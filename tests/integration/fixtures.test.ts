import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { endeavourSpecSchema, evaluateActivation } from "../../src/server/domain/endeavour-spec";
import { DEFAULT_MAILBOX_LIMITS } from "../../src/server/domain/mailbox";
import { FIXTURE_BRIEF, FIXTURE_IDS, purgeFixtures, seedFixtures } from "../../src/server/db/fixtures";
import * as t from "../../src/server/db/schema";
import { countRows, testDb, truncateAll } from "./helpers";

const handle = testDb();
afterAll(() => handle.close());
beforeEach(() => truncateAll(handle));

describe("fixtures", () => {
  it("seed a spec that passes the activation gate", async () => {
    await seedFixtures(handle.db);
    const [row] = await handle.db.select().from(t.endeavours).where(eq(t.endeavours.id, FIXTURE_IDS.endeavour));
    expect(row).toBeDefined();
    const spec = endeavourSpecSchema.parse(row!.spec);
    expect(evaluateActivation(spec, { brief: FIXTURE_BRIEF, connectedMailboxIds: [FIXTURE_IDS.mailbox] })).toEqual({
      ready: true,
      blockers: [],
    });
  });

  it("purge leaves zero rows in every table", async () => {
    await seedFixtures(handle.db);
    const before = await countRows(handle);
    expect(before["messages"]).toBe(2);
    await purgeFixtures(handle.db);
    const after = await countRows(handle);
    expect(Object.entries(after).filter(([, n]) => n > 0)).toEqual([]);
  });

  it("purge does not touch real data", async () => {
    await handle.db.insert(t.mailboxes).values({
      id: "mbx_real",
      address: "real@example.com",
      displayName: "Real",
      provider: "google",
      limits: DEFAULT_MAILBOX_LIMITS,
    });
    await seedFixtures(handle.db);
    await purgeFixtures(handle.db);
    const rows = await handle.db.select({ id: t.mailboxes.id }).from(t.mailboxes);
    expect(rows).toEqual([{ id: "mbx_real" }]);
  });
});
