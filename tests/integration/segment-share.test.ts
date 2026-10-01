import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { pinSegmentShare } from "../../src/server/commands/segment-share";
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

const stored = async () => {
  const [row] = await db.select().from(t.segments).where(eq(t.segments.id, FIXTURE_IDS.segment));
  return row;
};

describe("pinning a segment's share", () => {
  it("starts unpinned, which is the equal split", async () => {
    expect((await stored())?.pinnedShare).toBeNull();
  });

  it("stores a share and gives it back", async () => {
    await pinSegmentShare(db, { segmentId: FIXTURE_IDS.segment, share: 30 });
    expect((await stored())?.pinnedShare).toBe(30);
  });

  it("returns a segment to the split", async () => {
    await pinSegmentShare(db, { segmentId: FIXTURE_IDS.segment, share: 30 });
    await pinSegmentShare(db, { segmentId: FIXTURE_IDS.segment, share: null });
    expect((await stored())?.pinnedShare).toBeNull();
  });

  it("allows nothing at all, which is how a segment is held back without retiring it", async () => {
    await pinSegmentShare(db, { segmentId: FIXTURE_IDS.segment, share: 0 });
    expect((await stored())?.pinnedShare).toBe(0);
  });

  it("refuses a fraction or a negative, with the reason", async () => {
    await expect(pinSegmentShare(db, { segmentId: FIXTURE_IDS.segment, share: 2.5 })).rejects.toMatchObject({
      code: "invalid",
      message: expect.stringContaining("whole number"),
    });
    await expect(pinSegmentShare(db, { segmentId: FIXTURE_IDS.segment, share: -1 })).rejects.toMatchObject({
      code: "invalid",
    });
  });

  it("refuses a retired segment, which has no share to fix", async () => {
    await db.update(t.segments).set({ status: "retired" }).where(eq(t.segments.id, FIXTURE_IDS.segment));
    await expect(pinSegmentShare(db, { segmentId: FIXTURE_IDS.segment, share: 10 })).rejects.toMatchObject({
      code: "conflict",
    });
  });

  it("records what the other segments are left with, not only the number pinned", async () => {
    // Pinning one share is a decision about all of them, and the number alone does not say so.
    await db.insert(t.segments).values({
      id: "seg_other",
      endeavourId: FIXTURE_IDS.endeavour,
      name: "Another",
      definition: "d",
      signals: ["s"],
      painHypothesis: "p",
      priority: 2,
      specVersion: 1,
    });
    await pinSegmentShare(db, { segmentId: FIXTURE_IDS.segment, share: 30 });

    const [event] = await db.select().from(t.events).where(eq(t.events.eventType, "segment.share_pinned"));
    const detail = String(event?.payload["detail"] ?? "");
    expect(detail).toContain("pinned at 30");
    expect(detail).toContain("1 segment(s) share what is left");
  });
});
