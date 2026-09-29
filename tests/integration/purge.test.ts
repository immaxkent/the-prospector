import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { purgeEndeavour } from "../../src/server/commands/purge";
import { CommandError } from "../../src/server/commands/errors";
import * as t from "../../src/server/db/schema";
import { FIXTURE_IDS, seedFixtures } from "../../src/server/db/fixtures";
import { testDb, truncateAll } from "./helpers";

const handle = testDb();
const db = handle.db;
afterAll(() => handle.close());

const NAME = "£3K Solidity Sprint";

beforeEach(async () => {
  await truncateAll(handle);
  await seedFixtures(db);
  // The fixture endeavour is active; deleting one is a second deliberate act after pausing.
  await db.update(t.endeavours).set({ status: "paused" }).where(eq(t.endeavours.id, FIXTURE_IDS.endeavour));
});

const count = async (table: typeof t.prospects | typeof t.companies | typeof t.evidence | typeof t.threads) =>
  (await db.select().from(table)).length;

describe("purgeEndeavour", () => {
  it("removes the endeavour and everything the schema hangs off it", async () => {
    expect(await count(t.prospects)).toBeGreaterThan(0);
    const summary = await purgeEndeavour(db, { endeavourId: FIXTURE_IDS.endeavour, confirmName: NAME });

    expect(summary.endeavour).toBe(NAME);
    expect(await db.select().from(t.endeavours)).toHaveLength(0);
    expect(await count(t.prospects)).toBe(0);
    expect(await count(t.threads)).toBe(0);
    expect(await db.select().from(t.approvals)).toHaveLength(0);
    expect(await db.select().from(t.segments)).toHaveLength(0);
  });

  it("takes the companies with it, which nothing else would have", async () => {
    // Companies belong to no endeavour, so a cascade never reaches them.
    expect(await count(t.companies)).toBeGreaterThan(0);
    const summary = await purgeEndeavour(db, { endeavourId: FIXTURE_IDS.endeavour, confirmName: NAME });
    expect(summary.companies).toBeGreaterThan(0);
    expect(await count(t.companies)).toBe(0);
    // People cascade from the company.
    expect(await db.select().from(t.people)).toHaveLength(0);
  });

  it("keeps a company another endeavour is still using", async () => {
    await db.insert(t.endeavours).values({
      id: "end_other",
      name: "Another",
      kind: "sprint",
      status: "active",
      autonomyLevel: "DRAFT",
      spec: (await db.select().from(t.endeavours).where(eq(t.endeavours.id, FIXTURE_IDS.endeavour)))[0]!.spec,
      brief: "another",
    });
    await db.insert(t.prospects).values({
      id: "pro_other",
      endeavourId: "end_other",
      companyId: FIXTURE_IDS.company,
      stage: "qualified",
      reviewStatus: "qualified",
      source: "web_research",
    });

    const summary = await purgeEndeavour(db, { endeavourId: FIXTURE_IDS.endeavour, confirmName: NAME });
    expect(summary.companies).toBe(0);
    expect(await db.select().from(t.companies).where(eq(t.companies.id, FIXTURE_IDS.company))).toHaveLength(1);
  });

  it("sweeps up evidence, which has no foreign key to remove it", async () => {
    expect(await count(t.evidence)).toBeGreaterThan(0);
    const summary = await purgeEndeavour(db, { endeavourId: FIXTURE_IDS.endeavour, confirmName: NAME });
    expect(summary.evidence).toBeGreaterThan(0);
    expect(await count(t.evidence)).toBe(0);
  });

  it("refuses unless the name is typed back", async () => {
    await expect(
      purgeEndeavour(db, { endeavourId: FIXTURE_IDS.endeavour, confirmName: "solidity" }),
    ).rejects.toBeInstanceOf(CommandError);
    // Nothing was touched by the refusal.
    expect(await db.select().from(t.endeavours)).toHaveLength(1);
  });

  it("accepts the name whatever the case or surrounding space", async () => {
    await expect(
      purgeEndeavour(db, { endeavourId: FIXTURE_IDS.endeavour, confirmName: `  ${NAME.toUpperCase()} ` }),
    ).resolves.toMatchObject({ endeavour: NAME });
  });

  it("refuses an active endeavour: pause it first", async () => {
    await db.update(t.endeavours).set({ status: "active" }).where(eq(t.endeavours.id, FIXTURE_IDS.endeavour));
    await expect(purgeEndeavour(db, { endeavourId: FIXTURE_IDS.endeavour, confirmName: NAME })).rejects.toBeInstanceOf(
      CommandError,
    );
  });

  it("refuses an endeavour that is not there", async () => {
    await expect(purgeEndeavour(db, { endeavourId: "end_nope", confirmName: NAME })).rejects.toBeInstanceOf(CommandError);
  });

  it("removes the finished intake that produced it, and leaves one still in progress", async () => {
    await db.insert(t.intakeSessions).values({
      id: "int_done",
      brief: "the brief that made it",
      status: "activated",
      endeavourId: FIXTURE_IDS.endeavour,
    });
    await db.insert(t.intakeSessions).values({ id: "int_live", brief: "still being written", status: "interviewing" });

    const summary = await purgeEndeavour(db, { endeavourId: FIXTURE_IDS.endeavour, confirmName: NAME });
    expect(summary.intakes).toBe(1);
    const left = await db.select().from(t.intakeSessions);
    expect(left.map((i) => i.id)).toEqual(["int_live"]);
  });
});
