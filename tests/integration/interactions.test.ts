import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { logInteraction } from "../../src/server/commands/interactions";
import { FIXTURE_IDS, seedFixtures } from "../../src/server/db/fixtures";
import * as t from "../../src/server/db/schema";
import { testDb, truncateAll } from "./helpers";

const handle = testDb();
const db = handle.db;
afterAll(() => handle.close());

const NOW = new Date("2026-09-17T09:00:00Z");

beforeEach(async () => {
  await truncateAll(handle);
  await seedFixtures(db);
  // The seeded prospect has already replied by email; this one has only been found.
  await db.insert(t.prospects).values({
    id: "pro_offchannel",
    endeavourId: FIXTURE_IDS.endeavour,
    segmentId: FIXTURE_IDS.segment,
    stage: "qualified",
    reviewStatus: "qualified",
    source: "web_research",
  });
});

const stageOf = async (id: string) => (await db.select().from(t.prospects).where(eq(t.prospects.id, id)))[0]?.stage;

describe("logging contact that did not go through the mailbox", () => {
  it("moves a prospect to contacted when the operator reached out elsewhere", async () => {
    const result = await logInteraction(db, {
      prospectId: "pro_offchannel",
      channel: "discord",
      direction: "outbound",
      occurredAt: NOW,
      note: "DM'd in their server",
    }, NOW);

    expect(result).toMatchObject({ stage: "contacted", moved: true });
    expect(await stageOf("pro_offchannel")).toBe("contacted");
  });

  it("moves it to replied when they answered, so it stops holding a pending slot", async () => {
    // A prospect in talks elsewhere reading as pending forever is what keeps the buffer
    // full and stops the engine for the wrong reason.
    await logInteraction(db, { prospectId: "pro_offchannel", channel: "discord", direction: "outbound", occurredAt: NOW }, NOW);
    await logInteraction(db, { prospectId: "pro_offchannel", channel: "discord", direction: "inbound", occurredAt: NOW }, NOW);
    expect(await stageOf("pro_offchannel")).toBe("replied");
  });

  it("never moves a prospect backwards", async () => {
    await db.update(t.prospects).set({ stage: "meeting" }).where(eq(t.prospects.id, "pro_offchannel"));
    const result = await logInteraction(db, { prospectId: "pro_offchannel", channel: "call", direction: "inbound", occurredAt: NOW }, NOW);
    expect(result).toMatchObject({ stage: "meeting", moved: false });
  });

  it("leaves a prospect the operator put aside where they put it", async () => {
    // nurture, lost and won are off the main line and are the operator's own placement.
    await db.update(t.prospects).set({ stage: "nurture" }).where(eq(t.prospects.id, "pro_offchannel"));
    await logInteraction(db, { prospectId: "pro_offchannel", channel: "linkedin", direction: "inbound", occurredAt: NOW }, NOW);
    expect(await stageOf("pro_offchannel")).toBe("nurture");
  });

  it("records it against the prospect, with when it happened rather than when it was typed", async () => {
    const happened = new Date("2026-09-15T14:00:00Z");
    await logInteraction(db, { prospectId: "pro_offchannel", channel: "call", direction: "inbound", occurredAt: happened, note: "  " }, NOW);

    const [row] = await db.select().from(t.interactions).where(eq(t.interactions.prospectId, "pro_offchannel"));
    expect(row).toMatchObject({ channel: "call", direction: "inbound", endeavourId: FIXTURE_IDS.endeavour });
    expect(row!.occurredAt.toISOString()).toBe(happened.toISOString());
    // A note of only whitespace is nothing, not an empty string pretending to be a note.
    expect(row!.note).toBeNull();
  });

  it("refuses contact from the future, and a prospect that was rejected", async () => {
    await expect(
      logInteraction(db, { prospectId: "pro_offchannel", channel: "call", direction: "inbound", occurredAt: new Date("2026-10-01T00:00:00Z") }, NOW),
    ).rejects.toMatchObject({ code: "invalid" });

    await db.update(t.prospects).set({ reviewStatus: "rejected" }).where(eq(t.prospects.id, "pro_offchannel"));
    await expect(
      logInteraction(db, { prospectId: "pro_offchannel", channel: "call", direction: "inbound", occurredAt: NOW }, NOW),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("stays out of the messages table, which is what keeps it out of the rates", async () => {
    // Structural, not a filter someone has to remember: the conversion rates are built from
    // messages, so an interaction cannot reach them by accident.
    const before = (await db.select().from(t.messages)).length;
    await logInteraction(db, { prospectId: "pro_offchannel", channel: "discord", direction: "inbound", occurredAt: NOW }, NOW);
    expect((await db.select().from(t.messages)).length).toBe(before);
  });
});
