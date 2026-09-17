import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { markThreadRead, setEndeavourStatus, updateOpportunity } from "../../src/server/commands/pipeline";
import { moveProspectStage, rejectProspect, restoreProspect, suppressProspect } from "../../src/server/commands/prospects";
import { FIXTURE_IDS, seedFixtures } from "../../src/server/db/fixtures";
import * as t from "../../src/server/db/schema";
import { testDb, truncateAll } from "./helpers";

const handle = testDb();
const db = handle.db;
afterAll(() => handle.close());

const prospect = async () => (await db.select().from(t.prospects).where(eq(t.prospects.id, FIXTURE_IDS.prospect)))[0]!;

async function pendingDraft() {
  await db.insert(t.messages).values({
    id: "msg_pending",
    threadId: FIXTURE_IDS.thread,
    endeavourId: FIXTURE_IDS.endeavour,
    prospectId: FIXTURE_IDS.prospect,
    direction: "outbound",
    messageClass: "follow_up",
    subject: "Follow up",
    body: "Checking in",
    sendState: "pending_approval",
  });
  await db.insert(t.approvals).values({
    id: "apr_pending",
    endeavourId: FIXTURE_IDS.endeavour,
    kind: "outreach_draft",
    subjectType: "message",
    subjectId: "msg_pending",
  });
}

async function opportunity(stage: "proposal" | "won" = "proposal") {
  await db.insert(t.opportunities).values({
    id: "opp_1",
    endeavourId: FIXTURE_IDS.endeavour,
    prospectId: FIXTURE_IDS.prospect,
    name: "Bridge review",
    value: 750,
    currency: "GBP",
    stage,
  });
}

beforeEach(async () => {
  await truncateAll(handle);
  await seedFixtures(db);
});

describe("rejecting and restoring", () => {
  it("rejects with a reason and withdraws unsent drafts and their approvals", async () => {
    await pendingDraft();
    await expect(rejectProspect(db, { prospectId: FIXTURE_IDS.prospect, reason: " " })).rejects.toMatchObject({ code: "invalid" });
    await rejectProspect(db, { prospectId: FIXTURE_IDS.prospect, reason: "Already audited" });
    expect(await prospect()).toMatchObject({ reviewStatus: "rejected", rejectionReason: "Already audited" });
    const [msg] = await db.select().from(t.messages).where(eq(t.messages.id, "msg_pending"));
    const [apr] = await db.select().from(t.approvals).where(eq(t.approvals.id, "apr_pending"));
    expect([msg!.sendState, apr!.status]).toEqual(["rejected", "rejected"]);
    const [sent] = await db.select().from(t.messages).where(eq(t.messages.id, FIXTURE_IDS.outbound));
    expect(sent!.sendState).toBe("sent");

    await expect(rejectProspect(db, { prospectId: FIXTURE_IDS.prospect, reason: "again" })).rejects.toMatchObject({ code: "conflict" });
    await restoreProspect(db, { prospectId: FIXTURE_IDS.prospect });
    expect(await prospect()).toMatchObject({ reviewStatus: "needs_review", rejectionReason: null });
  });
});

describe("suppression", () => {
  it("suppresses the email once and rejects the prospect", async () => {
    await pendingDraft();
    const result = await suppressProspect(db, { prospectId: FIXTURE_IDS.prospect, scope: "email", reason: "Asked not to be contacted" });
    expect(result).toEqual({ kind: "email", value: "ilse@northbridge.example" });
    await restoreProspect(db, { prospectId: FIXTURE_IDS.prospect });
    await suppressProspect(db, { prospectId: FIXTURE_IDS.prospect, scope: "email", reason: "again" });
    expect(await db.select().from(t.suppressions)).toHaveLength(1);
    expect((await prospect()).reviewStatus).toBe("rejected");
  });

  it("can suppress the whole domain", async () => {
    await expect(
      suppressProspect(db, { prospectId: FIXTURE_IDS.prospect, scope: "domain", reason: "" }),
    ).resolves.toEqual({ kind: "domain", value: "northbridge.example" });
  });
});

describe("stages and opportunities", () => {
  it("lets the operator correct stages and closes the open opportunity on won", async () => {
    await opportunity();
    await moveProspectStage(db, { prospectId: FIXTURE_IDS.prospect, to: "contacted" });
    expect((await prospect()).stage).toBe("contacted");
    await moveProspectStage(db, { prospectId: FIXTURE_IDS.prospect, to: "won" });
    const [opp] = await db.select().from(t.opportunities);
    expect(opp!.stage).toBe("won");
    await expect(moveProspectStage(db, { prospectId: FIXTURE_IDS.prospect, to: "won" })).rejects.toMatchObject({ code: "conflict" });
    const types = (await db.select().from(t.events)).map((e) => e.eventType);
    expect(types).toContain("opportunity.won");
  });

  it("updates value and probability and records outcomes once", async () => {
    await opportunity();
    await expect(updateOpportunity(db, { opportunityId: "opp_1", value: -1 })).rejects.toMatchObject({ code: "invalid" });
    await expect(updateOpportunity(db, { opportunityId: "opp_1", probability: 1.5 })).rejects.toMatchObject({ code: "invalid" });
    await updateOpportunity(db, { opportunityId: "opp_1", value: 1200, probability: 0.7 });
    await updateOpportunity(db, { opportunityId: "opp_1", outcome: { stage: "lost", reason: "Went with a firm" } });
    const [opp] = await db.select().from(t.opportunities);
    expect(opp).toMatchObject({ value: 1200, probabilityUserDefined: 0.7, stage: "lost", outcomeReason: "Went with a firm" });
    expect((await prospect()).stage).toBe("lost");
    await expect(
      updateOpportunity(db, { opportunityId: "opp_1", outcome: { stage: "won", reason: "x" } }),
    ).rejects.toMatchObject({ code: "conflict" });
  });
});

describe("endeavours and threads", () => {
  it("pauses, resumes and archives, and never reopens an archive", async () => {
    const status = async () => (await db.select().from(t.endeavours))[0]!.status;
    await setEndeavourStatus(db, { endeavourId: FIXTURE_IDS.endeavour, status: "paused" });
    expect(await status()).toBe("paused");
    await setEndeavourStatus(db, { endeavourId: FIXTURE_IDS.endeavour, status: "active" });
    await setEndeavourStatus(db, { endeavourId: FIXTURE_IDS.endeavour, status: "archived" });
    await expect(setEndeavourStatus(db, { endeavourId: FIXTURE_IDS.endeavour, status: "active" })).rejects.toMatchObject({
      code: "conflict",
    });
  });

  it("marks threads read or unread", async () => {
    await markThreadRead(db, { threadId: FIXTURE_IDS.thread });
    expect((await db.select().from(t.threads))[0]!.unread).toBe(false);
    await markThreadRead(db, { threadId: FIXTURE_IDS.thread, unread: true });
    expect((await db.select().from(t.threads))[0]!.unread).toBe(true);
    await expect(markThreadRead(db, { threadId: "thr_missing" })).rejects.toMatchObject({ code: "not_found" });
  });
});
