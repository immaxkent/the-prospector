import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { FixtureAgentLlm } from "../../src/server/agent/fixture";
import { FIXTURE_IDS, seedFixtures } from "../../src/server/db/fixtures";
import * as t from "../../src/server/db/schema";
import { dbRecorder } from "../../src/server/llm/recorder";
import type { Notification } from "../../src/server/notify/channels";
import { REVIEW_SENT } from "../../src/server/reports/collect";
import { sendReport } from "../../src/server/reports/send";
import { testDb, truncateAll } from "./helpers";

const handle = testDb();
const db = handle.db;
afterAll(() => handle.close());

const NOW = new Date("2026-09-17T08:00:00Z");

function send(agent: { llm: FixtureAgentLlm; model: string; record: ReturnType<typeof dbRecorder> } | null = null) {
  const sent: Notification[] = [];
  return {
    sent,
    run: () =>
      sendReport(
        db,
        { notifications: { name: "test", deliver: async (n: Notification) => void sent.push(n) }, agent },
        { endeavourId: FIXTURE_IDS.endeavour, kind: "review", now: NOW },
      ),
  };
}

beforeEach(async () => {
  await truncateAll(handle);
  await seedFixtures(db);
});

describe("the weekly review", () => {
  it("asks about the reply nobody has answered, naming the company", async () => {
    const { sent, run } = send();
    expect(await run()).toMatchObject({ sent: true });
    expect(sent[0]!.body).toContain("FOLLOW UP WITH THESE");
    expect(sent[0]!.body).toContain("Northbridge Protocol");
  });

  it("always carries NEWS with the sample size, and refuses to rate a small one", async () => {
    const { sent, run } = send();
    await run();
    expect(sent[0]!.body).toContain("NEWS");
    expect(sent[0]!.body).toContain("pending");
    // One send in the fixtures is nowhere near enough to quote a reply rate from.
    expect(sent[0]!.body).toMatch(/too few to rate|nothing sent yet/);
    expect(sent[0]!.body).not.toMatch(/\d+% reply rate/);
  });

  it("goes out even in a week that needs nothing, unlike the digest", async () => {
    // A day's silence means nothing happened. A week's silence means nobody knows whether
    // anything is running.
    await db.delete(t.messages);
    await db.delete(t.prospects);

    const { sent, run } = send();
    expect(await run()).toMatchObject({ sent: true });
    expect(sent[0]!.title).toBe("£3K Solidity Sprint · this week");
    expect(sent[0]!.body).toContain("Nothing is waiting on you this week.");
  });

  it("asks about a conversation happening elsewhere that has gone quiet", async () => {
    await db.insert(t.prospects).values({
      id: "pro_discord",
      endeavourId: FIXTURE_IDS.endeavour,
      segmentId: FIXTURE_IDS.segment,
      companyId: FIXTURE_IDS.company,
      stage: "contacted",
      reviewStatus: "qualified",
      source: "manual",
      releasedAt: NOW,
    });
    await db.insert(t.interactions).values({
      id: "ixn_old",
      endeavourId: FIXTURE_IDS.endeavour,
      prospectId: "pro_discord",
      channel: "discord",
      direction: "inbound",
      occurredAt: new Date("2026-08-20T10:00:00Z"),
    });

    const { sent, run } = send();
    await run();
    expect(sent[0]!.body).toContain("UPDATE ON THESE");
    expect(sent[0]!.body).toContain("in talks elsewhere");
  });

  it("records what it sent, which is what stops a second going out the same day", async () => {
    const { run } = send();
    await run();
    const [event] = await db.select().from(t.events).where(eq(t.events.eventType, REVIEW_SENT));
    expect(event).toBeTruthy();
    expect(String(event?.payload["detail"])).toContain("this week");
  });

  it("falls back to a plain opening line rather than losing the review", async () => {
    // The lists are the part that matters and they are already counted. A model that is
    // unavailable must not cost the operator the whole report.
    const broken = {
      llm: { complete: async () => { throw new Error("provider down"); } } as never,
      model: "claude-opus-5",
      record: dbRecorder(db),
    };
    const { sent, run } = send(broken);
    expect(await run()).toMatchObject({ sent: true });
    expect(sent[0]!.body).toMatch(/need you this week|Nothing is waiting on you/);
  });
});

describe("the objective warning", () => {
  it("says the goal is not enough when the arithmetic says so", async () => {
    // The setpoints are about capacity and know nothing about the objective, so without
    // this a perfectly healthy endeavour sits at its numbers while the deadline passes.
    await db
      .update(t.endeavours)
      .set({ settings: { prospecting: { maximumPending: 50, activeGoal: 2, paused: false } } })
      .where(eq(t.endeavours.id, FIXTURE_IDS.endeavour));

    const { sent, run } = send();
    await run();
    expect(sent[0]!.body).toContain("will not reach the objective");
    // The basis is named: assumed rates are a guess the first replies will correct.
    expect(sent[0]!.body).toContain("assumed rates");
  });

  it("stays quiet when the goal is enough", async () => {
    await db
      .update(t.endeavours)
      .set({ settings: { prospecting: { maximumPending: 50, activeGoal: 400, paused: false } } })
      .where(eq(t.endeavours.id, FIXTURE_IDS.endeavour));

    const { sent, run } = send();
    await run();
    expect(sent[0]!.body).not.toContain("will not reach the objective");
  });
});
