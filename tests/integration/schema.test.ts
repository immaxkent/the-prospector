import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { runMigrations } from "../../src/server/db/migrate";
import { FIXTURE_IDS, seedFixtures } from "../../src/server/db/fixtures";
import * as t from "../../src/server/db/schema";
import { testDb, truncateAll } from "./helpers";

const handle = testDb();
afterAll(() => handle.close());
beforeEach(async () => {
  await truncateAll(handle);
  await seedFixtures(handle.db);
});

/** Postgres error code for the thrown query, unwrapping drizzle's wrapper. */
async function pgCode(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    const err = e as { code?: string; cause?: { code?: string } };
    return err.code ?? err.cause?.code;
  }
  return undefined;
}

const UNIQUE_VIOLATION = "23505";
const FK_VIOLATION = "23503";

describe("constraints", () => {
  it("re-running migrations is a no-op", async () => {
    await expect(runMigrations(process.env["DATABASE_URL"]!)).resolves.toBeUndefined();
  });

  it("stores each external email message once", async () => {
    const code = await pgCode(
      handle.db.insert(t.messages).values({
        id: "msg_dupe",
        threadId: FIXTURE_IDS.thread,
        direction: "inbound",
        externalMessageId: "fixture-message-2",
        subject: "dupe",
        body: "dupe",
      }),
    );
    expect(code).toBe(UNIQUE_VIOLATION);
  });

  it("allows only one pending approval per subject, but history is kept", async () => {
    const again = {
      id: "apr_second",
      endeavourId: FIXTURE_IDS.endeavour,
      kind: "reply_approval" as const,
      subjectType: "thread" as const,
      subjectId: FIXTURE_IDS.thread,
    };
    expect(await pgCode(handle.db.insert(t.approvals).values(again))).toBe(UNIQUE_VIOLATION);

    await handle.db.update(t.approvals).set({ status: "approved" }).where(eq(t.approvals.id, FIXTURE_IDS.approval));
    expect(await pgCode(handle.db.insert(t.approvals).values(again))).toBeUndefined();
  });

  it("suppresses an address once", async () => {
    const row = { kind: "email" as const, value: "no@example.com", reason: "unsubscribed" };
    await handle.db.insert(t.suppressions).values({ id: "sup_1", ...row });
    expect(await pgCode(handle.db.insert(t.suppressions).values({ id: "sup_2", ...row }))).toBe(UNIQUE_VIOLATION);
  });

  it("will not delete a mailbox an endeavour still sends through", async () => {
    const code = await pgCode(handle.db.delete(t.mailboxes).where(eq(t.mailboxes.id, FIXTURE_IDS.mailbox)));
    expect(code).toBe(FK_VIOLATION);
  });

  it("runs once per endeavour per day", async () => {
    const run = { endeavourId: FIXTURE_IDS.endeavour, runDate: "2026-09-17", trigger: "schedule" as const };
    await handle.db.insert(t.dailyRuns).values({ id: "run_1", ...run });
    expect(await pgCode(handle.db.insert(t.dailyRuns).values({ id: "run_2", ...run, trigger: "manual" }))).toBe(
      UNIQUE_VIOLATION,
    );
  });

  it("gives events a monotonic cursor", async () => {
    const base = { sourceSystem: "prospector", eventType: "x", entityType: "endeavour", entityId: "e", payload: {} };
    await handle.db.insert(t.events).values([
      { id: "evt_1", ...base },
      { id: "evt_2", ...base },
    ]);
    const rows = await handle.db.select({ id: t.events.id, seq: t.events.seq }).from(t.events).orderBy(t.events.seq);
    expect(rows.map((r) => r.id)).toEqual(["evt_1", "evt_2"]);
    expect(rows[1]!.seq).toBeGreaterThan(rows[0]!.seq);
  });

  it("deleting an endeavour cascades its operational rows", async () => {
    await handle.db.delete(t.endeavours).where(eq(t.endeavours.id, FIXTURE_IDS.endeavour));
    expect(await handle.db.select().from(t.prospects)).toHaveLength(0);
    expect(await handle.db.select().from(t.messages)).toHaveLength(0);
    expect(await handle.db.select().from(t.approvals)).toHaveLength(0);
  });
});
