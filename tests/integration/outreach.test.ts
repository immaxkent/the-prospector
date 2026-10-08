import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createOutreachDraft } from "../../src/server/commands/outreach";
import { CommandError } from "../../src/server/commands/errors";
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

const draft = (over: Partial<Parameters<typeof createOutreachDraft>[1]> = {}) =>
  createOutreachDraft(db, {
    prospectId: FIXTURE_IDS.prospect,
    subject: "Bridge review before mainnet",
    body: "Hello",
    evidenceIds: [FIXTURE_IDS.evidence],
    messageClass: "new_outreach",
    templateVersion: "2026-10-01.1",
    ...over,
  });

const recipientOf = async () => {
  const [approval] = await db.select().from(t.approvals).where(eq(t.approvals.kind, "outreach_draft"));
  return (approval?.payload as { recipient?: string } | undefined)?.recipient ?? null;
};

/** No named person on the prospect, only what research found for the company. */
async function companyOnly(contacts: { channel: "email" | "discord"; value: string; preferred?: boolean }[]) {
  await db.update(t.prospects).set({ personId: null }).where(eq(t.prospects.id, FIXTURE_IDS.prospect));
  await db.update(t.companies).set({ contacts }).where(eq(t.companies.id, FIXTURE_IDS.company));
}

describe("createOutreachDraft and the address it writes to", () => {
  it("writes to the named person when there is one", async () => {
    const out = await draft();
    expect(out).toMatchObject({ created: true, needsApproval: true });
    expect(await recipientOf()).toBe("Ilse Vermeer <ilse@northbridge.example>");
  });

  /*
   * This is the bug the prospect screen exposed. The generic inboxes research was told to
   * collect in WP-23 were stored, scored and shown as the route that would be used — and then
   * never used, because this command only looked at a named person's address and refused
   * everything else.
   */
  it("writes to the company's own inbox when nobody is named", async () => {
    await companyOnly([{ channel: "email", value: "hello@northbridge.example" }]);
    await draft();
    expect(await recipientOf()).toBe("Northbridge Protocol <hello@northbridge.example>");
  });

  it("writes to the address the operator chose, over the one research would rank first", async () => {
    await db.update(t.companies).set({
      contacts: [{ channel: "email", value: "mira@northbridge.example", preferred: true }],
    }).where(eq(t.companies.id, FIXTURE_IDS.company));
    await draft();
    expect(await recipientOf()).toBe("Ilse Vermeer <mira@northbridge.example>");
  });

  it("refuses when the only route is one it cannot send on", async () => {
    // A Discord invite is a real route, but one the operator opens; drafting an email to it
    // would be a draft that could never be sent.
    await companyOnly([{ channel: "discord", value: "discord.gg/northbridge" }]);
    await expect(draft()).rejects.toBeInstanceOf(CommandError);
  });

  it("refuses when there is no route at all", async () => {
    await companyOnly([]);
    await expect(draft()).rejects.toBeInstanceOf(CommandError);
  });

  it("refuses a rejected prospect whatever its contacts say", async () => {
    await db.update(t.prospects).set({ reviewStatus: "rejected" }).where(eq(t.prospects.id, FIXTURE_IDS.prospect));
    await expect(draft()).rejects.toBeInstanceOf(CommandError);
  });

  it("will not open a second draft while one is already waiting", async () => {
    await draft();
    await expect(draft()).rejects.toBeInstanceOf(CommandError);
  });
});
