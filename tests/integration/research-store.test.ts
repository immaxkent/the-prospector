import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { Candidate } from "../../src/server/agent/research";
import { knownTargetNames, storeCandidates } from "../../src/server/commands/research";
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

const candidate = (over: Partial<Candidate> = {}): Candidate => ({
  company: { name: "Havsledd Labs", domain: "havsledd.example", description: "Vault protocol" },
  person: { name: "Tomas Lindqvist", role: "Lead engineer", email: "tomas@havsledd.example" },
  trigger: { type: "incident", description: "Testnet incident postmortem published" },
  evidence: [
    { claim: "Postmortem cites missing invariant tests", sourceRef: "https://havsledd.example/post", excerpt: "…", confidence: 0.8 },
    { claim: "Mainnet planned for November", sourceRef: "https://havsledd.example/roadmap", excerpt: "…", confidence: 0.6 },
  ],
  ...over,
});

const store = (candidates: Candidate[]) =>
  storeCandidates(db, { endeavourId: FIXTURE_IDS.endeavour, segmentId: FIXTURE_IDS.segment, candidates, runId: "run_1" });

describe("storeCandidates", () => {
  it("records a timezone research established, and fills one in later", async () => {
    await store([candidate({ company: { name: "Havsledd Labs", domain: "havsledd.example", timezone: "Europe/Stockholm" } })]);
    const [company] = await db.select().from(t.companies).where(eq(t.companies.name, "Havsledd Labs"));
    expect(company!.timezone).toBe("Europe/Stockholm");

    // A second sighting of a company we already knew fills in what was missing.
    await db.update(t.companies).set({ timezone: null }).where(eq(t.companies.id, company!.id));
    await store([candidate({ company: { name: "Havsledd Labs", domain: "havsledd.example", timezone: "Europe/Stockholm" } })]);
    const [again] = await db.select().from(t.companies).where(eq(t.companies.id, company!.id));
    expect(again!.timezone).toBe("Europe/Stockholm");
  });

  it("drops a timezone this runtime cannot resolve rather than mis-aiming a send", async () => {
    await store([candidate({ company: { name: "Nowhere Labs", timezone: "Mars/Olympus" } })]);
    const [company] = await db.select().from(t.companies).where(eq(t.companies.name, "Nowhere Labs"));
    expect(company!.timezone).toBeNull();
  });

  it("creates the company, person, prospect, evidence and trigger", async () => {
    const result = await store([candidate()]);
    expect(result).toMatchObject({ suppressed: 0, duplicates: 0 });
    expect(result.created).toHaveLength(1);

    const [prospect] = await db.select().from(t.prospects).where(eq(t.prospects.id, result.created[0]!));
    expect(prospect).toMatchObject({ stage: "researched", reviewStatus: "researching", source: "web_research", segmentId: FIXTURE_IDS.segment });

    const claims = await db.select().from(t.evidence).where(eq(t.evidence.entityId, prospect!.id));
    expect(claims).toHaveLength(2);
    expect(claims[0]).toMatchObject({ sourceType: "web", runId: "run_1" });
    const [trigger] = await db.select().from(t.triggers).where(eq(t.triggers.prospectId, prospect!.id));
    expect(trigger).toMatchObject({ type: "incident" });
    expect((await db.select().from(t.events)).map((e) => e.eventType)).toContain("prospect.researched");
  });

  it("reuses an existing company and person instead of duplicating them", async () => {
    await store([candidate()]);
    await db.delete(t.prospects).where(eq(t.prospects.source, "web_research"));
    await store([candidate({ company: { name: "Havsledd Labs renamed", domain: "havsledd.example" } })]);
    expect(await db.select().from(t.companies).where(eq(t.companies.domain, "havsledd.example"))).toHaveLength(1);
    expect(await db.select().from(t.people).where(eq(t.people.email, "tomas@havsledd.example"))).toHaveLength(1);
  });

  it("does not add the same prospect to an endeavour twice", async () => {
    await store([candidate()]);
    const again = await store([candidate()]);
    expect(again).toMatchObject({ duplicates: 1, created: [] });
  });

  it("skips anyone on the do-not-contact list, by address or domain", async () => {
    await db.insert(t.suppressions).values({ id: "sup_1", kind: "email", value: "tomas@havsledd.example", reason: "asked to stop" });
    expect(await store([candidate()])).toMatchObject({ suppressed: 1, created: [] });

    await db.delete(t.suppressions);
    await db.insert(t.suppressions).values({ id: "sup_2", kind: "domain", value: "havsledd.example", reason: "competitor" });
    expect(await store([candidate()])).toMatchObject({ suppressed: 1, created: [] });
    expect(await db.select().from(t.prospects).where(eq(t.prospects.source, "web_research"))).toHaveLength(0);
  });

  it("stores a company without a named person", async () => {
    const result = await store([candidate({ person: undefined })]);
    const [prospect] = await db.select().from(t.prospects).where(eq(t.prospects.id, result.created[0]!));
    expect(prospect!.personId).toBeNull();
  });
});

describe("knownTargetNames", () => {
  it("lists companies already targeted by the endeavour", async () => {
    await store([candidate()]);
    const names = await knownTargetNames(db, FIXTURE_IDS.endeavour);
    expect(names).toEqual(expect.arrayContaining(["Havsledd Labs", "Northbridge Protocol"]));
  });
});
