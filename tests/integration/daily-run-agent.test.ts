import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { FixtureAgentLlm } from "../../src/server/agent/fixture";
import type { BatchItem } from "../../src/server/llm/batch";
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
    // It says why it stopped rather than silently calling the target met.
    expect(text).toContain("found nobody new");

    const calls = await db.select().from(t.llmCalls);
    // The fixture thread also carries a reply, so the run classifies it in the same pass.
    // Research runs twice: the day's target counts qualified prospects, and the fixture's
    // one candidate comes back needs_review, so the run looks again — then stops, because
    // the second look returned nobody new.
    expect(calls.map((c) => c.role).sort()).toEqual([
      "conversation.classify",
      "research.discover",
      "research.discover",
      "research.qualify",
    ]);
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
  /**
   * The fixture prospect is qualified, reachable, and released — all three, because
   * qualification alone no longer licenses an email. The operator's release is what does.
   */
  async function qualifiedProspect() {
    await db
      .update(t.prospects)
      .set({
        stage: "qualified",
        reviewStatus: "qualified",
        scoreReason: "Mainnet in six weeks, no audit",
        releasedAt: new Date("2026-09-16T08:00:00Z"),
      })
      .where(eq(t.prospects.id, FIXTURE_IDS.prospect));
    await db.delete(t.messages);
    await db.delete(t.approvals);
  }

  it("writes nothing for a prospect the operator has not released", async () => {
    await qualifiedProspect();
    await db.update(t.prospects).set({ releasedAt: null }).where(eq(t.prospects.id, FIXTURE_IDS.prospect));
    await run({ agent: agent() });
    expect(await db.select().from(t.approvals).where(eq(t.approvals.kind, "outreach_draft"))).toHaveLength(0);
    // And it says who it is waiting on rather than reporting nobody qualified.
    expect(await logText()).toContain("waiting for you to release");
  });

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

  it("records which offer the draft pitched, so its performance can be read later", async () => {
    await qualifiedProspect();
    await run({ agent: agent() });

    const [draft] = await db.select().from(t.messages).where(eq(t.messages.sendState, "pending_approval"));
    expect(draft!.offerId).toBe(FIXTURE_IDS.offer);
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

describe("follow-ups", () => {
  /** A contacted prospect with one sent email and no reply. */
  async function contactedDaysAgo(days: number) {
    const sentAt = new Date(NOW.getTime() - days * 86_400_000);
    await db.delete(t.approvals);
    await db.delete(t.messages).where(eq(t.messages.direction, "inbound"));
    await db.update(t.messages).set({ sentAt, messageClass: "new_outreach" }).where(eq(t.messages.id, FIXTURE_IDS.outbound));
    await db
      .update(t.prospects)
      .set({ stage: "contacted", reviewStatus: "qualified" })
      .where(eq(t.prospects.id, FIXTURE_IDS.prospect));
  }

  it("drafts a follow-up once the gap has passed", async () => {
    await contactedDaysAgo(4);
    await run({ agent: agent() });

    const [followUp] = await db.select().from(t.messages).where(eq(t.messages.messageClass, "follow_up"));
    expect(followUp).toMatchObject({ sendState: "pending_approval", prospectId: FIXTURE_IDS.prospect });
    const [approval] = await db.select().from(t.approvals).where(eq(t.approvals.kind, "outreach_draft"));
    expect(approval!.payload).toMatchObject({ why: "Follow-up 1: no reply yet" });
    expect(await logText()).toContain("follow-up 1 ready for approval");
  });

  it("waits while it is too soon and records when it is next due", async () => {
    await contactedDaysAgo(1);
    await run({ agent: agent() });
    expect(await db.select().from(t.messages).where(eq(t.messages.messageClass, "follow_up"))).toHaveLength(0);
    const [prospect] = await db.select().from(t.prospects).where(eq(t.prospects.id, FIXTURE_IDS.prospect));
    expect(prospect).toMatchObject({ nextAction: "Follow-up due" });
    expect(prospect!.nextActionAt).toEqual(new Date(NOW.getTime() + 2 * 86_400_000));
  });

  it("never chases someone who already replied", async () => {
    await contactedDaysAgo(10);
    await db.insert(t.messages).values({
      id: "msg_reply_now",
      threadId: FIXTURE_IDS.thread,
      endeavourId: FIXTURE_IDS.endeavour,
      prospectId: FIXTURE_IDS.prospect,
      direction: "inbound",
      subject: "Re: Bridge",
      body: "Costs look fine, let us talk Friday.",
      receivedAt: new Date(NOW.getTime() - 86_400_000),
    });
    await run({ agent: agent() });
    expect(await db.select().from(t.messages).where(eq(t.messages.messageClass, "follow_up"))).toHaveLength(0);
  });

  it("parks a prospect in nurture once the sequence is spent", async () => {
    await contactedDaysAgo(30);
    for (const [i, id] of ["f1", "f2", "f3"].entries()) {
      await db.insert(t.messages).values({
        id,
        threadId: FIXTURE_IDS.thread,
        endeavourId: FIXTURE_IDS.endeavour,
        prospectId: FIXTURE_IDS.prospect,
        direction: "outbound",
        messageClass: "follow_up",
        subject: `Follow-up ${i + 1}`,
        body: "Checking in",
        sendState: "sent",
        sentAt: new Date(NOW.getTime() - (20 - i * 5) * 86_400_000),
      });
    }
    await run({ agent: agent() });
    const [prospect] = await db.select().from(t.prospects).where(eq(t.prospects.id, FIXTURE_IDS.prospect));
    expect(prospect).toMatchObject({ stage: "nurture", nextAction: "No reply after the full sequence" });
    expect(await logText()).toContain("parked in nurture");
  });
});

describe("learning", () => {
  it("says nothing from a small sample", async () => {
    await run({ agent: agent() });
    expect(await db.select().from(t.insights)).toHaveLength(0);
    expect(await logText()).toContain("not enough evidence yet");
  });

  it("recommends the better segment once the sample is big enough, with the numbers", async () => {
    const [segment] = await db.select().from(t.segments);
    const [weak] = await db
      .insert(t.segments)
      .values({
        id: "seg_weak",
        endeavourId: FIXTURE_IDS.endeavour,
        name: "General protocols",
        definition: "Everyone else",
        signals: [],
        painHypothesis: "unknown",
        priority: 2,
        specVersion: 1,
      })
      .returning();

    // 20 contacted in each segment: the strong one replies positively, the weak one does not.
    for (const [index, config] of [
      { segmentId: segment!.id, positive: true },
      { segmentId: weak!.id, positive: false },
    ].entries()) {
      for (let i = 0; i < 20; i++) {
        const prospectId = `pro_${index}_${i}`;
        await db.insert(t.prospects).values({
          id: prospectId,
          endeavourId: FIXTURE_IDS.endeavour,
          segmentId: config.segmentId,
          companyId: FIXTURE_IDS.company,
          stage: "replied",
          reviewStatus: "qualified",
          source: "web_research",
        });
        await db.insert(t.messages).values({
          id: `msg_${index}_${i}`,
          threadId: FIXTURE_IDS.thread,
          endeavourId: FIXTURE_IDS.endeavour,
          prospectId,
          direction: "outbound",
          messageClass: "new_outreach",
          subject: "Hello",
          body: "…",
          sendState: "sent",
          sentAt: new Date("2026-09-16T09:00:00Z"),
          templateVersion: "outreach.draft/2026-09-17.1",
        });
        if (config.positive && i < 6) {
          await db.insert(t.messages).values({
            id: `in_${index}_${i}`,
            threadId: FIXTURE_IDS.thread,
            endeavourId: FIXTURE_IDS.endeavour,
            prospectId,
            direction: "inbound",
            subject: "Re: Hello",
            body: "Interested",
            receivedAt: new Date("2026-09-16T12:00:00Z"),
            classification: { intent: "interested", objections: [] },
          });
        }
      }
    }

    await run({ agent: agent() });
    const recommendations = await db.select().from(t.insights).where(eq(t.insights.type, "recommendation"));
    expect(recommendations).toHaveLength(1);
    // 20 seeded plus the fixture prospect, which is in the same segment and replied.
    expect(recommendations[0]!.statement).toContain("7/21");
    expect(recommendations[0]!.statement).toContain("0/20");
    expect(recommendations[0]!.statement).toContain("Launch-stage protocols");
    expect(recommendations[0]!.evidence).toMatchObject({ dimension: "segment" });

    // Running again does not duplicate the same open insight.
    await db.delete(t.dailyRuns);
    await run({ agent: agent(), now: new Date("2026-09-17T11:00:00Z") });
    expect(await db.select().from(t.insights).where(eq(t.insights.type, "recommendation"))).toHaveLength(1);
  });

  it("raises a repeated objection as a commercial signal", async () => {
    for (let i = 0; i < 3; i++) {
      await db.insert(t.messages).values({
        id: `obj_${i}`,
        threadId: FIXTURE_IDS.thread,
        endeavourId: FIXTURE_IDS.endeavour,
        prospectId: FIXTURE_IDS.prospect,
        direction: "inbound",
        subject: "Re: Hello",
        body: "We already have an auditor",
        receivedAt: new Date("2026-09-16T12:00:00Z"),
        classification: { intent: "objection", objections: ["We already have an auditor lined up"] },
      });
    }
    await run({ agent: agent() });
    const [signal] = await db.select().from(t.insights).where(eq(t.insights.type, "signal"));
    expect(signal!.statement).toContain("3 times");
    expect((await db.select().from(t.events)).map((e) => e.eventType)).toContain("commercial.signal.detected");
  });
});

describe("batched qualification", () => {
  /** A batch client that answers every question at once, the way the real one does. */
  const batching = () => {
    const base = agent();
    const seen: number[] = [];
    return {
      seen,
      deps: {
        ...base,
        batch: {
          completeMany: async (items: readonly BatchItem[]) => {
            seen.push(items.length);
            return Promise.all(items.map(async (item) => ({ id: item.id, response: await base.llm.complete(item.request) })));
          },
        },
      },
    };
  };

  it("asks about every waiting prospect in one batch", async () => {
    await db.insert(t.prospects).values(
      [1, 2].map((n) => ({
        id: `pro_waiting_${n}`,
        endeavourId: FIXTURE_IDS.endeavour,
        companyId: FIXTURE_IDS.company,
        stage: "researched" as const,
        reviewStatus: "researching" as const,
        source: "web_research",
      })),
    );
    const { deps, seen } = batching();
    await run({ agent: deps });
    // One batch, holding every prospect that was waiting, rather than a call each.
    expect(seen.length).toBe(1);
    expect(seen[0]).toBeGreaterThanOrEqual(2);
  });

  it("writes the day's drafts in one batch too", async () => {
    await db
      .update(t.prospects)
      .set({
        stage: "qualified",
        reviewStatus: "qualified",
        scoreReason: "Mainnet in six weeks, no audit",
        releasedAt: new Date("2026-09-16T08:00:00Z"),
      })
      .where(eq(t.prospects.id, FIXTURE_IDS.prospect));
    await db.delete(t.messages);
    await db.delete(t.approvals);
    const { deps, seen } = batching();
    await run({ agent: deps });
    const drafts = await db.select().from(t.messages).where(eq(t.messages.sendState, "pending_approval"));
    expect(drafts.length).toBeGreaterThanOrEqual(1);
    // Qualification and drafting each ask once, rather than once per prospect.
    expect(seen.length).toBeGreaterThanOrEqual(1);
    const [draftCall] = await db.select().from(t.llmCalls).where(eq(t.llmCalls.role, "outreach.draft"));
    expect(draftCall).toBeDefined();
  });

  it("records a batched call at half the token price", async () => {
    const { deps } = batching();
    await run({ agent: deps });
    const [batched] = await db.select().from(t.llmCalls).where(eq(t.llmCalls.role, "research.qualify"));
    const [inline] = await db.select().from(t.llmCalls).where(eq(t.llmCalls.role, "research.discover"));
    // Same fixture usage either way, so a cheaper row can only be the batch discount.
    expect(batched!.costUsd).toBeLessThan(inline!.costUsd);
  });
});

describe("search budget", () => {
  it("looks only as hard as the shortfall justifies, and records what it cost", async () => {
    const { runId } = await run({ agent: agent() });
    const [runRow] = await db.select().from(t.dailyRuns).where(eq(t.dailyRuns.id, runId));
    // The fixture agent reports one search per call; the point is that it is counted.
    expect(runRow!.metrics).toHaveProperty("searches");
    expect(await logText()).toMatch(/search cap\)/);
  });

  it("never asks for more searches than the ceiling allows", async () => {
    await run({ agent: agent() });
    const caps = [...(await logText()).matchAll(/\((\d+) search cap\)/g)].map((m) => Number(m[1]));
    expect(caps.length).toBeGreaterThan(0);
    for (const cap of caps) {
      expect(cap).toBeGreaterThanOrEqual(2);
      expect(cap).toBeLessThanOrEqual(8);
    }
  });
});

describe("workload", () => {
  /** The cadence is a ceiling; what the day actually needs falls as the pipeline fills. */
  const logFor = async () => (await db.select().from(t.runLog)).map((l) => l.text).join("\n");

  it("explains the day's target in the log, and admits when rates are assumed", async () => {
    await run({ agent: agent() });
    const log = await logFor();
    expect(log).toMatch(/still to win over \d+ day\(s\)/);
    expect(log).toContain("assumed rates, not measured ones");
  });

  it("asks for less work once the objective is already covered", async () => {
    // Enough won value to cover the objective outright.
    await db.insert(t.opportunities).values({
      id: "opp_big",
      endeavourId: FIXTURE_IDS.endeavour,
      prospectId: FIXTURE_IDS.prospect,
      name: "Closed",
      value: 999_999,
      currency: "GBP",
      stage: "won",
    });
    await run({ agent: agent() });
    const [runRow] = await db.select().from(t.dailyRuns);
    expect(runRow!.metrics).toMatchObject({ targetToday: 0 });
    expect(await logFor()).toContain("no new prospects are needed today");
  });

  it("works towards a partnerships objective, which has no price at all", async () => {
    // Five partnerships rather than pounds: pricing does not apply, and must not be needed.
    const [endeavour] = await db.select().from(t.endeavours).where(eq(t.endeavours.id, FIXTURE_IDS.endeavour));
    const spec = endeavour!.spec as Record<string, unknown>;
    await db
      .update(t.endeavours)
      .set({
        spec: {
          ...spec,
          objective: { state: "confirmed", value: { metric: "partners", target: 5, unit: "COUNT" } },
          pricing: { state: "not_applicable", reason: "a partnership is not bought" },
        } as never,
      })
      .where(eq(t.endeavours.id, FIXTURE_IDS.endeavour));

    await run({ agent: agent() });
    const [runRow] = await db.select().from(t.dailyRuns);
    expect((runRow!.metrics as Record<string, number>)["targetToday"]).toBeGreaterThan(0);
    expect(await logText()).toContain("each one counts once");
  });

  it("says so when the objective cannot be reached at these rates", async () => {
    await run({ agent: agent() });
    const [runRow] = await db.select().from(t.dailyRuns);
    const brief = runRow!.brief as { risks: string[] } | null;
    // The fixture objective is far beyond what a 5% reply rate reaches in the time left.
    expect((brief?.risks ?? []).join(" ")).toContain("out of reach");
  });
});

describe("notifications", () => {
  it("tells the operator when approvals are waiting after a run", async () => {
    await run({ agent: agent() });
    const waiting = await db.select().from(t.notifications).where(eq(t.notifications.kind, "approvals_waiting"));
    expect(waiting).toHaveLength(1);
    expect(waiting[0]!.title).toMatch(/approval/);
    expect(waiting[0]!.body).toContain("before anything is sent");
  });

  it("says nothing when there is nothing waiting", async () => {
    await db.delete(t.approvals);
    await db.delete(t.messages).where(eq(t.messages.direction, "inbound"));
    await db.update(t.prospects).set({ reviewStatus: "rejected" }).where(eq(t.prospects.id, FIXTURE_IDS.prospect));
    await run({ agent: agent() });
    expect(await db.select().from(t.notifications).where(eq(t.notifications.kind, "approvals_waiting"))).toHaveLength(0);
  });

  it("tells the operator the day a prospect replies with interest", async () => {
    await run({ agent: agent() });
    const [reply] = await db.select().from(t.notifications).where(eq(t.notifications.kind, "reply_question"));
    expect(reply!.title).toContain("Northbridge Protocol");
    expect(reply!.body.length).toBeGreaterThan(0);
  });

  it("says nothing about a reply that only asks to be left alone", async () => {
    await db
      .update(t.messages)
      .set({ body: "Please unsubscribe me from this list.", classification: null })
      .where(eq(t.messages.direction, "inbound"));
    await run({ agent: agent() });
    const kinds = (await db.select().from(t.notifications)).map((n) => n.kind);
    expect(kinds.some((k) => k.startsWith("reply_"))).toBe(false);
  });

  it("reports a failed run and a mailbox that needs reconnecting", async () => {
    await db.update(t.mailboxes).set({ status: "needs_reauth" }).where(eq(t.mailboxes.id, FIXTURE_IDS.mailbox));
    await run({ agent: agent() });
    const [stale] = await db.select().from(t.notifications).where(eq(t.notifications.kind, "mailbox_needs_reauth"));
    expect(stale!.body).toContain("max@consulting.example");

    await db.delete(t.dailyRuns);
    await db.update(t.endeavours).set({ status: "paused" }).where(eq(t.endeavours.id, FIXTURE_IDS.endeavour));
    await expect(run({ agent: agent(), now: new Date("2026-09-17T11:00:00Z") })).rejects.toThrow("not active");
    const [failed] = await db.select().from(t.notifications).where(eq(t.notifications.kind, "run_failed"));
    expect(failed!.title).toContain("failed at load");
  });
});

describe("the prospecting setpoints", () => {
  const setpoints = (prospecting: { maximumPending: number; activeGoal: number; paused: boolean }) =>
    db
      .update(t.endeavours)
      .set({ settings: { prospecting } })
      .where(eq(t.endeavours.id, FIXTURE_IDS.endeavour));

  /** Prospects that occupy the pending buffer without being researched by this run. */
  const fillBuffer = async (n: number, stage: "qualified" | "replied") => {
    for (let i = 0; i < n; i++) {
      await db.insert(t.prospects).values({
        id: `pro_fill_${stage}_${i}`,
        endeavourId: FIXTURE_IDS.endeavour,
        segmentId: FIXTURE_IDS.segment,
        stage,
        reviewStatus: "qualified",
        source: "import",
      });
    }
  };

  it("stops when the buffer is full, and says how full and what unblocks it", async () => {
    // The stall is deliberate — nothing leaves the buffer without the operator — so the one
    // thing that must never happen is the run going quiet without saying why.
    await setpoints({ maximumPending: 3, activeGoal: 20, paused: false });
    await fillBuffer(3, "qualified");

    const { runId } = await run({ agent: agent() });
    const text = await logText();
    // The seeded fixture prospect has already replied, so it is active rather than pending.
    expect(text).toContain("Prospecting is paused: 3/3 pending");
    expect(text).toContain("Dequeue or reject to resume");

    // Gaps reach the operator as the brief's risks, which is where they will read them.
    const [runRow] = await db.select().from(t.dailyRuns).where(eq(t.dailyRuns.id, runId));
    const risks = (runRow!.brief?.["risks"] ?? []) as string[];
    expect(risks.join("\n")).toContain("Dequeue or reject to resume");
    // Nothing was researched, so nothing was paid for.
    expect(await db.select().from(t.prospects).where(eq(t.prospects.source, "web_research"))).toHaveLength(0);
  });

  it("calls a met goal a met goal, not a full queue", async () => {
    // Both are true when the pipeline is healthy. Reporting the queue would send the
    // operator off to clear work that is doing exactly what it should.
    await setpoints({ maximumPending: 1, activeGoal: 2, paused: false });
    await fillBuffer(2, "replied");

    await run({ agent: agent() });
    const text = await logText();
    // Two seeded plus the fixture prospect, which has also replied.
    expect(text).toContain("3 live conversation(s), which is the goal of 2");
    expect(text).not.toContain("Dequeue or reject");
  });

  it("does nothing at all while the operator has it paused", async () => {
    await setpoints({ maximumPending: 50, activeGoal: 20, paused: true });
    await run({ agent: agent() });

    expect(await logText()).toContain("Prospecting is paused. Nothing new will be looked for");
    expect(await db.select().from(t.prospects).where(eq(t.prospects.source, "web_research"))).toHaveLength(0);
  });

  it("asks every segment, rather than letting the first one take the buffer", async () => {
    // The bug this replaces: one target for the endeavour, taken in priority order, so the
    // broadest segment filled the day and the others were never researched at all.
    await db.insert(t.segments).values([
      {
        id: "seg_second",
        endeavourId: FIXTURE_IDS.endeavour,
        name: "Second segment",
        definition: "Another kind of buyer",
        signals: ["a signal"],
        painHypothesis: "a pain",
        priority: 2,
        specVersion: 1,
      },
      {
        id: "seg_third",
        endeavourId: FIXTURE_IDS.endeavour,
        name: "Third segment",
        definition: "A third kind of buyer",
        signals: ["a signal"],
        painHypothesis: "a pain",
        priority: 3,
        specVersion: 1,
      },
    ]);

    await run({ agent: agent() });
    const text = await logText();
    for (const name of ["Second segment", "Third segment"]) {
      expect(text).toContain(name);
    }
    // And the split is reported, so the operator can see where the buffer went.
    expect(text).toMatch(/\d+\/\d+ pending · room for \d+ across 3 segment\(s\)/);
  });
});
