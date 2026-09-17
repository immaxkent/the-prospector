import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { importProspects } from "../../src/server/commands/import";
import { FIXTURE_IDS, seedFixtures } from "../../src/server/db/fixtures";
import * as t from "../../src/server/db/schema";
import { testDb, truncateAll } from "./helpers";

const handle = testDb();
const db = handle.db;
afterAll(() => handle.close());
beforeEach(async () => {
  await truncateAll(handle);
  await seedFixtures(db);
});

const rows = [
  { company: "Havsledd Labs", domain: "havsledd.example", person: "Tomas", email: "tomas@havsledd.example", note: "Met in June" },
  { company: "Meridian Settlements", person: "Ada", email: "ada@meridian.example", trigger: "Grant awarded" },
];

describe("importProspects", () => {
  it("creates prospects with their evidence marked as imported", async () => {
    const result = await importProspects(db, { endeavourId: FIXTURE_IDS.endeavour, segmentId: FIXTURE_IDS.segment, rows });
    expect(result).toMatchObject({ imported: 2, duplicates: 0, suppressed: 0 });

    const imported = await db.select().from(t.prospects).where(eq(t.prospects.source, "import"));
    expect(imported).toHaveLength(2);
    expect(imported[0]).toMatchObject({ stage: "researched", reviewStatus: "researching", segmentId: FIXTURE_IDS.segment });

    const claims = await db.select().from(t.evidence).where(eq(t.evidence.sourceType, "import"));
    expect(claims.map((c) => c.claim)).toContain("Met in June");
  });

  it("skips duplicates and suppressed addresses, and says how many", async () => {
    await db.insert(t.suppressions).values({ id: "sup_1", kind: "email", value: "ada@meridian.example", reason: "asked to stop" });
    await importProspects(db, { endeavourId: FIXTURE_IDS.endeavour, rows });
    const again = await importProspects(db, { endeavourId: FIXTURE_IDS.endeavour, rows });
    expect(again).toMatchObject({ imported: 0, duplicates: 1, suppressed: 1 });
  });

  it("refuses an unknown endeavour or segment, and an empty list", async () => {
    await expect(importProspects(db, { endeavourId: "end_missing", rows })).rejects.toMatchObject({ code: "not_found" });
    await expect(
      importProspects(db, { endeavourId: FIXTURE_IDS.endeavour, segmentId: "seg_missing", rows }),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(importProspects(db, { endeavourId: FIXTURE_IDS.endeavour, rows: [] })).rejects.toMatchObject({ code: "invalid" });
  });

  it("matches an existing company instead of creating a second one", async () => {
    await importProspects(db, {
      endeavourId: FIXTURE_IDS.endeavour,
      rows: [{ company: "Northbridge Protocol", domain: "northbridge.example", person: "Someone Else", email: "other@northbridge.example" }],
    });
    expect(await db.select().from(t.companies).where(eq(t.companies.domain, "northbridge.example"))).toHaveLength(1);
  });
});
