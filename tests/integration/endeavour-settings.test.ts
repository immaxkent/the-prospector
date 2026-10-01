import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { CommandError } from "../../src/server/commands/errors";
import { loadEndeavourSettings, updateEndeavourSettings } from "../../src/server/commands/endeavour-settings";
import { FIXTURE_IDS, seedFixtures } from "../../src/server/db/fixtures";
import * as t from "../../src/server/db/schema";
import { DEFAULT_PACING } from "../../src/server/domain/pacing";
import { DEFAULT_PROSPECTING } from "../../src/server/domain/prospecting";
import { testDb, truncateAll } from "./helpers";

const handle = testDb();
const db = handle.db;
afterAll(() => handle.close());

beforeEach(async () => {
  await truncateAll(handle);
  await seedFixtures(db);
});

const base = { endeavourId: FIXTURE_IDS.endeavour, pacing: DEFAULT_PACING, followUpDays: [3, 7, 14] };

describe("prospecting setpoints", () => {
  it("start at their defaults on an endeavour that has never set them", async () => {
    expect(await loadEndeavourSettings(db, FIXTURE_IDS.endeavour)).toMatchObject({ prospecting: DEFAULT_PROSPECTING });
  });

  it("are stored and read back", async () => {
    await updateEndeavourSettings(db, { ...base, prospecting: { maximumPending: 30, activeGoal: 8, paused: true, allocation: "even" as const } });
    const settings = await loadEndeavourSettings(db, FIXTURE_IDS.endeavour);
    expect(settings.prospecting).toEqual({ maximumPending: 30, activeGoal: 8, paused: true, allocation: "even" as const });
  });

  it("survive an edit that does not mention them", async () => {
    // The pacing form does not know the setpoints exist. Writing settings wholesale would
    // have reset them to the defaults every time someone changed a send window.
    await updateEndeavourSettings(db, { ...base, prospecting: { maximumPending: 30, activeGoal: 8, paused: true, allocation: "even" as const } });
    await updateEndeavourSettings(db, { ...base, followUpDays: [2, 5] });

    const settings = await loadEndeavourSettings(db, FIXTURE_IDS.endeavour);
    expect(settings.prospecting).toEqual({ maximumPending: 30, activeGoal: 8, paused: true, allocation: "even" as const });
    expect(settings.followUpDays).toEqual([2, 5]);
  });

  it("are refused with the reason rather than quietly corrected", async () => {
    await expect(
      updateEndeavourSettings(db, { ...base, prospecting: { maximumPending: 900, activeGoal: 20, paused: false, allocation: "even" as const } }),
    ).rejects.toMatchObject({ code: "invalid", message: expect.stringContaining("between 1 and 500") });

    // And nothing was written on the way to refusing.
    expect(await loadEndeavourSettings(db, FIXTURE_IDS.endeavour)).toMatchObject({ prospecting: DEFAULT_PROSPECTING });
  });

  it("refuses a fraction", async () => {
    const attempt = updateEndeavourSettings(db, {
      ...base,
      prospecting: { maximumPending: 50, activeGoal: 12.5, paused: false, allocation: "even" },
    });
    await expect(attempt).rejects.toBeInstanceOf(CommandError);
  });

  it("records what changed, so the change is visible without diffing json", async () => {
    await updateEndeavourSettings(db, { ...base, prospecting: { maximumPending: 30, activeGoal: 8, paused: true, allocation: "even" as const } });
    const [event] = await db
      .select()
      .from(t.events)
      .where(eq(t.events.eventType, "endeavour.settings_updated"));
    // recordEvent keeps detail inside the payload rather than in a column of its own.
    const detail = String(event?.payload["detail"] ?? "");
    expect(detail).toContain("up to 30 pending, 8 live");
    expect(detail).toContain("prospecting paused");
  });
});
