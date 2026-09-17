import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { FixtureAgentLlm } from "../../src/server/agent/fixture";
import { FIXTURE_IDS, seedFixtures } from "../../src/server/db/fixtures";
import * as t from "../../src/server/db/schema";
import { runDailyLoop } from "../../src/server/jobs/daily-run";
import { dbRecorder } from "../../src/server/llm/recorder";
import { testDb, truncateAll } from "./helpers";

const handle = testDb();
const db = handle.db;
afterAll(() => handle.close());
beforeEach(async () => {
  await truncateAll(handle);
  await seedFixtures(db);
});

const NOW = new Date("2026-09-17T09:00:00Z");
const agent = () => ({ llm: new FixtureAgentLlm(), model: "claude-opus-5", record: dbRecorder(db) });
const run = (over: Partial<Parameters<typeof runDailyLoop>[1]> = {}) =>
  runDailyLoop(db, { endeavourId: FIXTURE_IDS.endeavour, trigger: "manual", now: NOW, ...over });

const logText = async () => (await db.select().from(t.runLog)).map((l) => l.text).join("\n");

describe("daily run with an agent", () => {
  it("researches, stores evidence and qualifies what it found", async () => {
    const { runId } = await run({ agent: agent() });

    const found = await db.select().from(t.prospects).where(eq(t.prospects.source, "web_research"));
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ reviewStatus: "needs_review", segmentId: FIXTURE_IDS.segment });
    expect(found[0]!.qualificationScore).toBe(76);
    expect(found[0]!.scoreFactors).toHaveLength(7);
    expect(found[0]!.scoreReason).toContain("Fixture qualification");

    const claims = await db.select().from(t.evidence).where(eq(t.evidence.entityId, found[0]!.id));
    expect(claims[0]).toMatchObject({ sourceRef: "https://havsledd.example/postmortem", runId });

    const text = await logText();
    expect(text).toContain("1 proposed");
    expect(text).toContain("needs_review");

    const calls = await db.select().from(t.llmCalls);
    // The fixture thread also carries a reply, so the run classifies it in the same pass.
    expect(calls.map((c) => c.role).sort()).toEqual(["conversation.classify", "research.discover", "research.qualify"]);
    expect(calls.every((c) => c.status === "ok" && c.costUsd > 0)).toBe(true);
  });

  it("reports honestly when Claude is not configured", async () => {
    await run();
    const [row] = await db.select().from(t.dailyRuns);
    const brief = row!.brief as { risks: string[] };
    expect(brief.risks.join(" ")).toContain("Claude is not configured");
    expect(await db.select().from(t.prospects).where(eq(t.prospects.source, "web_research"))).toHaveLength(0);
  });

  it("stops researching once the day's target is met", async () => {
    await run({ agent: agent() });
    await db.delete(t.dailyRuns);
    await run({ agent: agent(), now: new Date("2026-09-17T11:00:00Z") });
    // The fixture agent offers the same candidate; it is already known, so nothing is added.
    expect(await db.select().from(t.prospects).where(eq(t.prospects.source, "web_research"))).toHaveLength(1);
    expect(await logText()).toContain("already known");
  });
});

describe("drafting", () => {
  /** The fixture prospect is qualified and reachable, so the run should draft to them. */
  async function qualifiedProspect() {
    await db
      .update(t.prospects)
      .set({ stage: "qualified", reviewStatus: "qualified", scoreReason: "Mainnet in six weeks, no audit" })
      .where(eq(t.prospects.id, FIXTURE_IDS.prospect));
    await db.delete(t.messages);
    await db.delete(t.approvals);
  }

  it("writes a draft that cites evidence and puts it in the approval queue", async () => {
    await qualifiedProspect();
    await run({ agent: agent() });

    const drafts = await db.select().from(t.messages).where(eq(t.messages.sendState, "pending_approval"));
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({ messageClass: "new_outreach", templateVersion: "outreach.draft/2026-09-17.1" });
    expect(drafts[0]!.evidenceIds).toEqual([FIXTURE_IDS.evidence]);
    expect(drafts[0]!.body).toContain("invariant tests");

    const [approval] = await db.select().from(t.approvals).where(eq(t.approvals.kind, "outreach_draft"));
    expect(approval).toMatchObject({ status: "pending", subjectType: "message", subjectId: drafts[0]!.id });
    expect(approval!.payload).toMatchObject({ recipient: "Ilse Vermeer <ilse@northbridge.example>" });
    expect(await logText()).toContain("draft ready for approval");
  });

  it("never sends: the draft only ever reaches approved once a human decides", async () => {
    await qualifiedProspect();
    await run({ agent: agent() });
    const sent = await db.select().from(t.messages).where(eq(t.messages.sendState, "sent"));
    expect(sent).toHaveLength(0);
  });

  it("writes nothing under OBSERVE autonomy", async () => {
    await qualifiedProspect();
    await db.update(t.endeavours).set({ autonomyLevel: "OBSERVE" }).where(eq(t.endeavours.id, FIXTURE_IDS.endeavour));
    await run({ agent: agent() });
    expect(await db.select().from(t.messages)).toHaveLength(0);
    expect(await logText()).toContain("autonomy_observe");
  });

  it("skips a prospect with no email address", async () => {
    await qualifiedProspect();
    await db.update(t.people).set({ email: null }).where(eq(t.people.id, FIXTURE_IDS.person));
    await run({ agent: agent() });
    expect(await db.select().from(t.messages)).toHaveLength(0);
    expect(await logText()).toContain("no email address");
  });
});

describe("replies", () => {
  /** A reply already sits in the fixture thread; the run should read and classify it. */
  it("classifies a reply and queues a suggested response", async () => {
    await run({ agent: agent() });
    const [reply] = await db.select().from(t.messages).where(eq(t.messages.id, FIXTURE_IDS.inbound));
    expect(reply!.classification).toMatchObject({ intent: "question" });
    expect(reply!.body).toBe("Yes, we would want this reviewed before Friday. What is the cost and what is covered?");

    const [approval] = await db.select().from(t.approvals).where(eq(t.approvals.kind, "reply_approval"));
    expect(approval!.payload).toMatchObject({ draft: expect.stringContaining("Fixed scope") });
    expect(await logText()).toContain("question");
  });

  it("stops outreach when a reply asks not to be contacted", async () => {
    await db
      .update(t.messages)
      .set({ body: "Please unsubscribe me, do not contact me again." })
      .where(eq(t.messages.id, FIXTURE_IDS.inbound));
    await db.insert(t.messages).values({
      id: "msg_pending_draft",
      threadId: FIXTURE_IDS.thread,
      endeavourId: FIXTURE_IDS.endeavour,
      prospectId: FIXTURE_IDS.prospect,
      direction: "outbound",
      messageClass: "follow_up",
      subject: "Following up",
      body: "Just checking in",
      sendState: "pending_approval",
    });

    await run({ agent: agent() });

    const [suppression] = await db.select().from(t.suppressions);
    expect(suppression).toMatchObject({ kind: "email", value: "ilse@northbridge.example" });
    const [draft] = await db.select().from(t.messages).where(eq(t.messages.id, "msg_pending_draft"));
    expect(draft!.sendState).toBe("rejected");
    const [prospect] = await db.select().from(t.prospects).where(eq(t.prospects.id, FIXTURE_IDS.prospect));
    expect(prospect).toMatchObject({ stage: "lost", reviewStatus: "rejected", rejectionReason: "Asked not to be contacted" });
    expect(await db.select().from(t.approvals).where(eq(t.approvals.kind, "reply_approval"))).toHaveLength(1); // the fixture's, not a new one
    expect(await logText()).toContain("asked not to be contacted");
  });
});
