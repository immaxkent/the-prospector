import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { FIXTURE_IDS, seedFixtures } from "../../src/server/db/fixtures";
import * as t from "../../src/server/db/schema";
import type { Notification } from "../../src/server/notify/channels";
import { DIGEST_SENT } from "../../src/server/reports/collect";
import { sendReport } from "../../src/server/reports/send";
import { testDb, truncateAll } from "./helpers";

const handle = testDb();
const db = handle.db;
afterAll(() => handle.close());

const NOW = new Date("2026-09-17T07:30:00Z");

function channel() {
  const sent: Notification[] = [];
  return { sent, notifications: { name: "test", deliver: async (n: Notification) => void sent.push(n) } };
}

const send = (over: { budgetRemainingPence?: number | null } = {}) => {
  const { sent, notifications } = channel();
  return {
    sent,
    run: () =>
      sendReport(
        db,
        { notifications, agent: null, ...(over.budgetRemainingPence !== undefined ? { budgetRemainingPence: over.budgetRemainingPence } : {}) },
        { endeavourId: FIXTURE_IDS.endeavour, kind: "digest", now: NOW },
      ),
  };
};

beforeEach(async () => {
  await truncateAll(handle);
  await seedFixtures(db);
});

describe("the morning digest", () => {
  it("reports the reply nobody has answered, because the fixture thread ends with theirs", async () => {
    const { sent, run } = send();
    const result = await run();

    expect(result).toMatchObject({ sent: true });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.body).toContain("waiting on you");
    expect(sent[0]!.priority).toBe("high");
    expect(sent[0]!.path).toBe(`/endeavours/${FIXTURE_IDS.endeavour}`);
  });

  it("stays quiet when nothing qualifies, and still records that it looked", async () => {
    // Nothing to say is worth recording: the scheduler asks when the last digest went out
    // to decide whether today's is due, so a quiet morning that recorded nothing would be
    // asked again every tick and then arrive at the wrong hour when something happened.
    await db.update(t.messages).set({ direction: "outbound" }).where(eq(t.messages.id, FIXTURE_IDS.inbound));

    const { sent, run } = send();
    expect(await run()).toMatchObject({ sent: false, reason: "nothing to report" });
    expect(sent).toHaveLength(0);

    const [event] = await db.select().from(t.events).where(eq(t.events.eventType, DIGEST_SENT));
    expect(String(event?.payload["detail"])).toBe("nothing needed saying");
  });

  it("says the budget is spent when it is, and says nothing about it when it cannot be read", async () => {
    const spent = send({ budgetRemainingPence: 0 });
    await spent.run();
    expect(spent.sent[0]!.body).toContain("model budget is spent");

    await truncateAll(handle);
    await seedFixtures(db);
    // Unknown is not exhausted: reporting it would send the operator after a problem that
    // may not exist.
    const unknown = send({ budgetRemainingPence: null });
    await unknown.run();
    expect(unknown.sent[0]!.body).not.toContain("model budget");
  });

  it("reports a stalled engine in the same words the run log uses", async () => {
    await db
      .update(t.endeavours)
      .set({ settings: { prospecting: { maximumPending: 1, activeGoal: 20, paused: false } } })
      .where(eq(t.endeavours.id, FIXTURE_IDS.endeavour));
    await db.insert(t.prospects).values({
      id: "pro_fill",
      endeavourId: FIXTURE_IDS.endeavour,
      segmentId: FIXTURE_IDS.segment,
      stage: "qualified",
      reviewStatus: "qualified",
      source: "import",
    });

    const { sent, run } = send();
    await run();
    expect(sent[0]!.body).toContain("Dequeue or reject to resume");
  });

  it("calls a failed send the mailbox's fault, not another task", async () => {
    await db.update(t.prospects).set({ releasedAt: NOW }).where(eq(t.prospects.id, FIXTURE_IDS.prospect));
    await db.update(t.messages).set({ sendState: "failed" }).where(eq(t.messages.id, FIXTURE_IDS.outbound));

    const { sent, run } = send();
    await run();
    expect(sent[0]!.body).toContain("That is the mailbox, not you");
  });

  it("does nothing for an endeavour that is not there", async () => {
    const { notifications } = channel();
    expect(await sendReport(db, { notifications, agent: null }, { endeavourId: "end_nope", kind: "digest", now: NOW })).toMatchObject({
      sent: false,
    });
  });
});
