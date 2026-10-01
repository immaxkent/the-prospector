import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { resolveProspects } from "../../src/server/commands/resolve";
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
  await db.insert(t.prospects).values(
    ["a", "b", "c"].map((suffix) => ({
      id: `pro_${suffix}`,
      endeavourId: FIXTURE_IDS.endeavour,
      segmentId: FIXTURE_IDS.segment,
      stage: "contacted" as const,
      reviewStatus: "qualified" as const,
      source: "web_research",
    })),
  );
});

const stageOf = async (id: string) => (await db.select().from(t.prospects).where(eq(t.prospects.id, id)))[0];

describe("resolving prospects in bulk", () => {
  it("dequeues several at once, which is the whole point of it", async () => {
    // Twenty separate confirmations is tedious, and an operator who finds it tedious stops
    // doing it — at which point the buffer fills and prospecting stops for good.
    const result = await resolveProspects(db, {
      endeavourId: FIXTURE_IDS.endeavour,
      prospectIds: ["pro_a", "pro_b", "pro_c"],
      resolution: "dequeue",
    }, NOW);

    expect(result.resolved).toHaveLength(3);
    expect(result.refused).toEqual([]);
    expect((await stageOf("pro_a"))?.stage).toBe("nurture");
  });

  it("keeps dequeue and reject apart, because they teach the agent different things", async () => {
    // "They never replied" is not a judgement about the company and must not be recorded
    // as a rejection reason the agent learns from.
    await resolveProspects(db, { endeavourId: FIXTURE_IDS.endeavour, prospectIds: ["pro_a"], resolution: "dequeue" }, NOW);
    const dequeued = await stageOf("pro_a");
    expect(dequeued).toMatchObject({ stage: "nurture", reviewStatus: "qualified", rejectionReason: null });

    await resolveProspects(
      db,
      { endeavourId: FIXTURE_IDS.endeavour, prospectIds: ["pro_b"], resolution: "reject", reason: "wrong size entirely" },
      NOW,
    );
    expect(await stageOf("pro_b")).toMatchObject({ stage: "lost", reviewStatus: "rejected", rejectionReason: "wrong size entirely" });
  });

  it("refuses a rejection with no reason", async () => {
    await expect(
      resolveProspects(db, { endeavourId: FIXTURE_IDS.endeavour, prospectIds: ["pro_a"], resolution: "reject" }, NOW),
    ).rejects.toMatchObject({ code: "invalid" });
  });

  it("marks a deal won without making it walk through every stage first", async () => {
    const result = await resolveProspects(db, { endeavourId: FIXTURE_IDS.endeavour, prospectIds: ["pro_a"], resolution: "won" }, NOW);
    expect(result.resolved).toEqual(["pro_a"]);
    expect((await stageOf("pro_a"))?.stage).toBe("won");
  });

  it("loses one bad id without losing the rest, and names what it refused", async () => {
    const result = await resolveProspects(
      db,
      { endeavourId: FIXTURE_IDS.endeavour, prospectIds: ["pro_a", "pro_nope", "pro_b"], resolution: "dequeue" },
      NOW,
    );
    expect(result.resolved.sort()).toEqual(["pro_a", "pro_b"]);
    expect(result.refused).toEqual([{ id: "pro_nope", reason: "not a prospect of this endeavour" }]);
  });

  it("treats already-there as done, not as a failure", async () => {
    await resolveProspects(db, { endeavourId: FIXTURE_IDS.endeavour, prospectIds: ["pro_a"], resolution: "dequeue" }, NOW);
    const again = await resolveProspects(db, { endeavourId: FIXTURE_IDS.endeavour, prospectIds: ["pro_a"], resolution: "dequeue" }, NOW);
    expect(again).toMatchObject({ resolved: ["pro_a"], refused: [] });
  });

  it("refuses an empty batch rather than recording a decision about nobody", async () => {
    await expect(
      resolveProspects(db, { endeavourId: FIXTURE_IDS.endeavour, prospectIds: [], resolution: "dequeue" }, NOW),
    ).rejects.toMatchObject({ code: "invalid" });
  });

  it("records the decision once for the batch, with how many and why", async () => {
    await resolveProspects(
      db,
      { endeavourId: FIXTURE_IDS.endeavour, prospectIds: ["pro_a", "pro_b"], resolution: "reject", reason: "no budget" },
      NOW,
    );
    const [event] = await db.select().from(t.events).where(eq(t.events.eventType, "prospect.resolved"));
    expect(String(event?.payload["detail"])).toBe("2 prospect(s) reject: no budget");
  });
});
