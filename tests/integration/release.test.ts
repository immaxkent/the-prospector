import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { addCompanyContact, holdProspect, releaseProspects } from "../../src/server/commands/release";
import { CommandError } from "../../src/server/commands/errors";
import * as t from "../../src/server/db/schema";
import { FIXTURE_IDS, seedFixtures } from "../../src/server/db/fixtures";
import { testDb, truncateAll } from "./helpers";

const handle = testDb();
const db = handle.db;
afterAll(() => handle.close());

const NOW = new Date("2026-09-29T10:00:00Z");

beforeEach(async () => {
  await truncateAll(handle);
  await seedFixtures(db);
});

const prospect = async (over: Partial<typeof t.prospects.$inferInsert> = {}) => {
  const id = `pro_${Math.random().toString(36).slice(2, 10)}`;
  await db.insert(t.prospects).values({
    id,
    endeavourId: FIXTURE_IDS.endeavour,
    companyId: FIXTURE_IDS.company,
    stage: "qualified",
    reviewStatus: "qualified",
    source: "web_research",
    ...over,
  });
  return id;
};

const read = async (id: string) => (await db.select().from(t.prospects).where(eq(t.prospects.id, id)))[0]!;

describe("releaseProspects", () => {
  it("releases a qualified prospect and stamps when", async () => {
    const id = await prospect();
    const result = await releaseProspects(db, { endeavourId: FIXTURE_IDS.endeavour, prospectIds: [id] }, NOW);
    expect(result).toEqual({ released: [id], refused: [] });
    expect((await read(id)).releasedAt).toEqual(NOW);
  });

  it("releases one the model sent to review, which is what review is for", async () => {
    const id = await prospect({ reviewStatus: "needs_review" });
    const result = await releaseProspects(db, { endeavourId: FIXTURE_IDS.endeavour, prospectIds: [id] }, NOW);
    expect(result.released).toEqual([id]);
  });

  it("leaves the assessment alone", async () => {
    const id = await prospect({ reviewStatus: "needs_review", qualificationScore: 71, scoreReason: "Strong fit, no contact" });
    await releaseProspects(db, { endeavourId: FIXTURE_IDS.endeavour, prospectIds: [id] }, NOW);
    expect(await read(id)).toMatchObject({ reviewStatus: "needs_review", qualificationScore: 71, scoreReason: "Strong fit, no contact" });
  });

  it("refuses a rejected prospect, and says so by id", async () => {
    const id = await prospect({ reviewStatus: "rejected" });
    const result = await releaseProspects(db, { endeavourId: FIXTURE_IDS.endeavour, prospectIds: [id] }, NOW);
    expect(result.released).toEqual([]);
    expect(result.refused).toEqual([{ id, reason: "rejected prospects are not released" }]);
    expect((await read(id)).releasedAt).toBeNull();
  });

  it("releases the good ones in a batch and names only the bad", async () => {
    // One bad id must not lose the rest: that is the whole point of bulk.
    const good = await prospect();
    const alsoGood = await prospect({ reviewStatus: "needs_review" });
    const bad = await prospect({ reviewStatus: "rejected" });
    const result = await releaseProspects(
      db,
      { endeavourId: FIXTURE_IDS.endeavour, prospectIds: [good, bad, alsoGood] },
      NOW,
    );
    expect(result.released.sort()).toEqual([good, alsoGood].sort());
    expect(result.refused.map((r) => r.id)).toEqual([bad]);
  });

  it("treats releasing an already-released prospect as done, not as an error", async () => {
    const id = await prospect({ releasedAt: new Date("2026-09-01T00:00:00Z") });
    const result = await releaseProspects(db, { endeavourId: FIXTURE_IDS.endeavour, prospectIds: [id] }, NOW);
    expect(result.released).toEqual([id]);
    // The original stamp stands; releasing twice does not move it.
    expect((await read(id)).releasedAt).toEqual(new Date("2026-09-01T00:00:00Z"));
  });

  it("will not release a prospect belonging to another endeavour", async () => {
    const id = await prospect();
    const result = await releaseProspects(db, { endeavourId: "end_someone_else", prospectIds: [id] }, NOW);
    expect(result.refused).toEqual([{ id, reason: "not a prospect of this endeavour" }]);
  });

  it("refuses an empty request rather than recording nothing happened", async () => {
    await expect(releaseProspects(db, { endeavourId: FIXTURE_IDS.endeavour, prospectIds: [] })).rejects.toBeInstanceOf(
      CommandError,
    );
  });

  it("records one event for the batch, not one per prospect", async () => {
    const a = await prospect();
    const b = await prospect();
    await releaseProspects(db, { endeavourId: FIXTURE_IDS.endeavour, prospectIds: [a, b] }, NOW);
    const events = await db.select().from(t.events).where(eq(t.events.eventType, "prospect.released"));
    expect(events).toHaveLength(1);
    expect(events[0]!.payload).toMatchObject({ detail: "2 prospect(s) cleared for outreach" });
    // The ids are on the event, so the batch can be read back later.
    expect((events[0]!.payload as { prospectIds: string[] }).prospectIds.sort()).toEqual([a, b].sort());
  });
});

describe("holdProspect", () => {
  it("takes a prospect back off the list", async () => {
    const id = await prospect({ releasedAt: NOW });
    await holdProspect(db, { prospectId: id });
    expect((await read(id)).releasedAt).toBeNull();
  });

  it("refuses a prospect that does not exist", async () => {
    await expect(holdProspect(db, { prospectId: "pro_nope" })).rejects.toBeInstanceOf(CommandError);
  });
});

describe("addCompanyContact", () => {
  const company = FIXTURE_IDS.company;

  it("adds what the operator found, keeping what research already had", async () => {
    await db.update(t.companies).set({ contacts: [{ channel: "discord", value: "discord.gg/team" }] }).where(eq(t.companies.id, company));
    const { contacts } = await addCompanyContact(db, { companyId: company, channel: "email", value: "ilse@northbridge.example" });
    expect(contacts).toHaveLength(2);
    expect(contacts.map((c) => c.value)).toContain("discord.gg/team");
  });

  it("keeps where it came from when one is given", async () => {
    const { contacts } = await addCompanyContact(db, {
      companyId: company,
      channel: "email",
      value: "hello@northbridge.example",
      sourceRef: "https://northbridge.example/contact",
    });
    expect(contacts[0]).toMatchObject({ sourceRef: "https://northbridge.example/contact" });
  });

  it("refuses something that is not an address when the channel says email", async () => {
    await expect(addCompanyContact(db, { companyId: company, channel: "email", value: "@ilse" })).rejects.toBeInstanceOf(
      CommandError,
    );
  });

  it("accepts a handle on a channel that is not email", async () => {
    const { contacts } = await addCompanyContact(db, { companyId: company, channel: "telegram", value: "@northbridge" });
    expect(contacts[0]).toMatchObject({ channel: "telegram", value: "@northbridge" });
  });

  it("refuses a blank, and a duplicate of one already there", async () => {
    await expect(addCompanyContact(db, { companyId: company, channel: "email", value: "  " })).rejects.toBeInstanceOf(
      CommandError,
    );
    await addCompanyContact(db, { companyId: company, channel: "email", value: "hello@northbridge.example" });
    await expect(
      addCompanyContact(db, { companyId: company, channel: "email", value: "HELLO@northbridge.example" }),
    ).rejects.toBeInstanceOf(CommandError);
  });

  it("refuses a company that does not exist", async () => {
    await expect(addCompanyContact(db, { companyId: "com_nope", channel: "email", value: "a@b.com" })).rejects.toBeInstanceOf(
      CommandError,
    );
  });
});
