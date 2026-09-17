import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { decideApproval } from "../../src/server/commands/approvals";
import { CommandError } from "../../src/server/commands/errors";
import { FIXTURE_IDS, seedFixtures } from "../../src/server/db/fixtures";
import * as t from "../../src/server/db/schema";
import { testDb, truncateAll } from "./helpers";

const handle = testDb();
const db = handle.db;
afterAll(() => handle.close());

const now = new Date("2026-09-17T12:00:00Z");

async function draft(id = "msg_draft") {
  await db.insert(t.messages).values({
    id,
    threadId: FIXTURE_IDS.thread,
    endeavourId: FIXTURE_IDS.endeavour,
    prospectId: FIXTURE_IDS.prospect,
    direction: "outbound",
    messageClass: "follow_up",
    subject: "Following up",
    body: "Original copy",
    sendState: "pending_approval",
  });
  await db.insert(t.approvals).values({
    id: `apr_${id}`,
    endeavourId: FIXTURE_IDS.endeavour,
    kind: "outreach_draft",
    subjectType: "message",
    subjectId: id,
  });
  return `apr_${id}`;
}

const message = async (id: string) => (await db.select().from(t.messages).where(eq(t.messages.id, id)))[0]!;
const approval = async (id: string) => (await db.select().from(t.approvals).where(eq(t.approvals.id, id)))[0]!;
const eventTypes = async () => (await db.select().from(t.events)).map((e) => e.eventType).sort();

async function expectCode(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toBeInstanceOf(CommandError);
  await expect(p).rejects.toMatchObject({ code });
}

beforeEach(async () => {
  await truncateAll(handle);
  await seedFixtures(db);
});

describe("outreach drafts", () => {
  it("approve with edits moves the draft to approved, never to sent", async () => {
    const id = await draft();
    await decideApproval(db, { approvalId: id, decision: "approve", editedCopy: "  Edited copy " }, now);
    expect(await message("msg_draft")).toMatchObject({ sendState: "approved", body: "Edited copy", approvedAt: now });
    expect(await approval(id)).toMatchObject({ status: "approved", decidedAt: now });
    expect(await eventTypes()).toEqual(["approval.decided", "message.approved"]);
  });

  it("reject keeps the copy and records the reason", async () => {
    const id = await draft();
    await decideApproval(db, { approvalId: id, decision: "reject", note: "Too pushy" }, now);
    expect(await message("msg_draft")).toMatchObject({ sendState: "rejected", body: "Original copy" });
    expect(await approval(id)).toMatchObject({ status: "rejected", decisionNote: "Too pushy" });
  });

  it("cannot be decided twice or with empty copy", async () => {
    const id = await draft();
    await expectCode(decideApproval(db, { approvalId: id, decision: "approve", editedCopy: "   " }), "invalid");
    await decideApproval(db, { approvalId: id, decision: "approve" });
    await expectCode(decideApproval(db, { approvalId: id, decision: "reject" }), "conflict");
    await expectCode(decideApproval(db, { approvalId: "apr_missing", decision: "approve" }), "not_found");
  });

  it("refuses a draft that has already moved on", async () => {
    const id = await draft();
    await db.update(t.messages).set({ sendState: "sent" }).where(eq(t.messages.id, "msg_draft"));
    await expect(decideApproval(db, { approvalId: id, decision: "approve" })).rejects.toThrow("cannot move from sent");
    expect(await approval(id)).toMatchObject({ status: "pending" });
  });
});

describe("reply approvals", () => {
  it("approve creates an approved reply in the thread", async () => {
    await decideApproval(db, { approvalId: FIXTURE_IDS.approval, decision: "approve" }, now);
    const replies = await db.select().from(t.messages).where(eq(t.messages.messageClass, "reply"));
    expect(replies).toHaveLength(1);
    expect(replies[0]).toMatchObject({
      threadId: FIXTURE_IDS.thread,
      prospectId: FIXTURE_IDS.prospect,
      subject: "Re: Bridge contract review before mainnet",
      sendState: "approved",
    });
    expect(replies[0]!.body).toContain("Friday");
  });

  it("reject creates nothing", async () => {
    await decideApproval(db, { approvalId: FIXTURE_IDS.approval, decision: "reject" });
    expect(await db.select().from(t.messages).where(eq(t.messages.messageClass, "reply"))).toHaveLength(0);
  });
});

describe("thread mapping", () => {
  beforeEach(async () => {
    await db.insert(t.threads).values({
      id: "thr_unmapped",
      mailboxId: FIXTURE_IDS.mailbox,
      subject: "Who is this?",
      mappingState: "needs_review",
    });
    await db.insert(t.messages).values({
      id: "msg_unmapped",
      threadId: "thr_unmapped",
      direction: "inbound",
      subject: "Who is this?",
      body: "Interested",
    });
    await db.insert(t.approvals).values({
      id: "apr_map",
      endeavourId: FIXTURE_IDS.endeavour,
      kind: "thread_mapping",
      subjectType: "thread",
      subjectId: "thr_unmapped",
    });
  });

  it("approve assigns the thread and its messages to the chosen prospect", async () => {
    await expectCode(decideApproval(db, { approvalId: "apr_map", decision: "approve" }), "invalid");
    await decideApproval(db, { approvalId: "apr_map", decision: "approve", prospectId: FIXTURE_IDS.prospect });
    const [thread] = await db.select().from(t.threads).where(eq(t.threads.id, "thr_unmapped"));
    expect(thread).toMatchObject({ mappingState: "mapped", prospectId: FIXTURE_IDS.prospect, endeavourId: FIXTURE_IDS.endeavour });
    expect(await message("msg_unmapped")).toMatchObject({ prospectId: FIXTURE_IDS.prospect });
  });

  it("reject ignores the thread", async () => {
    await decideApproval(db, { approvalId: "apr_map", decision: "reject" });
    const [thread] = await db.select().from(t.threads).where(eq(t.threads.id, "thr_unmapped"));
    expect(thread!.mappingState).toBe("ignored");
  });
});
