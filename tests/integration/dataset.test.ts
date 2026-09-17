import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { FIXTURE_IDS, seedFixtures } from "../../src/server/db/fixtures";
import * as t from "../../src/server/db/schema";
import { loadDataset } from "../../src/server/read/dataset";
import { testDb, truncateAll } from "./helpers";

const handle = testDb();
afterAll(() => handle.close());
beforeEach(() => truncateAll(handle));

const opts = { now: new Date("2026-09-17T12:00:00Z"), model: "claude-test", provider: "ANTHROPIC" };

describe("loadDataset", () => {
  it("returns an empty, waiting system on a clean install", async () => {
    const d = await loadDataset(handle.db, opts);
    expect(d).toMatchObject({
      isEmpty: true,
      endeavours: [],
      prospects: [],
      threads: [],
      approvals: [],
      mailboxes: [],
      brief: null,
      status: { agent: "WAITING", lastRunAt: "", db: "REMOTE", model: "claude-test" },
    });
    expect(d.interfaces.every((i) => i.inbound === 0 && i.events.length === 0)).toBe(true);
  });

  it("assembles every screen's records from the database", async () => {
    await seedFixtures(handle.db);
    const d = await loadDataset(handle.db, opts);

    expect(d.isEmpty).toBe(false);
    expect(d.endeavours).toHaveLength(1);
    expect(d.endeavours[0]).toMatchObject({ id: FIXTURE_IDS.endeavour, mailboxId: FIXTURE_IDS.mailbox, targetValue: 3000 });
    expect(d.mailboxes[0]).toMatchObject({ id: FIXTURE_IDS.mailbox, endeavourIds: [FIXTURE_IDS.endeavour] });

    expect(d.prospects[0]).toMatchObject({ person: "Ilse Vermeer", company: "Northbridge Protocol", score: 92 });
    expect(d.prospects[0]!.evidence.map((e) => e.id)).toEqual([FIXTURE_IDS.evidence]);

    expect(d.threads[0]!.messages.map((m) => m.author)).toEqual(["AGENT", "PROSPECT"]);
    expect(d.threads[0]!.suggestedResponse).toContain("Friday");

    expect(d.approvals).toHaveLength(1);
    expect(d.approvals[0]).toMatchObject({ kind: "REPLY_APPROVAL", recipient: "Ilse Vermeer <ilse@northbridge.example>" });
    expect(d.segments).toEqual([{ segment: "Launch-stage protocols", sent: 1, replies: 1, meetings: 0, wins: 0 }]);
  });

  it("drops archived endeavours and decided approvals", async () => {
    await seedFixtures(handle.db);
    await handle.db.update(t.approvals).set({ status: "approved" }).where(eq(t.approvals.id, FIXTURE_IDS.approval));
    expect((await loadDataset(handle.db, opts)).approvals).toEqual([]);

    await handle.db.update(t.endeavours).set({ status: "archived" }).where(eq(t.endeavours.id, FIXTURE_IDS.endeavour));
    const d = await loadDataset(handle.db, opts);
    expect(d.endeavours).toEqual([]);
    expect(d.prospects).toEqual([]);
    expect(d.mailboxes[0]!.endeavourIds).toEqual([]);
  });

  it("surfaces the latest successful brief and run log", async () => {
    await seedFixtures(handle.db);
    const brief = { date: "2026-09-17", changed: ["1 reply"], learned: [], today: ["Approve reply"], risks: [] };
    await handle.db.insert(t.dailyRuns).values({
      id: "run_1",
      endeavourId: FIXTURE_IDS.endeavour,
      runDate: "2026-09-17",
      trigger: "schedule",
      status: "succeeded",
      brief,
      metrics: { discovered: 4 },
      startedAt: new Date("2026-09-17T07:00:00Z"),
      finishedAt: new Date("2026-09-17T07:02:00Z"),
    });
    await handle.db.insert(t.runLog).values({ id: "log_1", runId: "run_1", level: "info", text: "loaded 1 endeavour" });

    const d = await loadDataset(handle.db, opts);
    expect(d.brief).toEqual(brief);
    expect(d.runs[0]).toMatchObject({ state: "OK", durationMs: 120_000, discovered: 4 });
    expect(d.runLog.map((l) => l.text)).toEqual(["loaded 1 endeavour"]);
    expect(d.status).toMatchObject({ agent: "ONLINE", lastRunAt: "2026-09-17T07:00:00.000Z" });
  });
});
