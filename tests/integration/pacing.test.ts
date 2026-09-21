import { randomBytes } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { decideApproval } from "../../src/server/commands/approvals";
import { scheduleSend } from "../../src/server/commands/schedule-send";
import { sendApprovedForMailbox, type SendDeps } from "../../src/server/commands/send";
import { sealJson } from "../../src/server/crypto/tokens";
import { FIXTURE_IDS, seedFixtures } from "../../src/server/db/fixtures";
import * as t from "../../src/server/db/schema";
import { DEFAULT_PACING, hourIn } from "../../src/server/domain/pacing";
import { GmailClient, type GmailContext } from "../../src/server/mailboxes/gmail";
import { testDb, truncateAll } from "./helpers";

const handle = testDb();
const db = handle.db;
afterAll(() => handle.close());

const key = randomBytes(32);
// 09:00 UTC is 10:00 in London: inside the 08:00-17:00 window.
const NOW = new Date("2026-09-17T09:00:00Z");
const tokens = { accessToken: "at", refreshToken: "rt", expiresAt: NOW.getTime() + 600_000, scope: "gmail" };
/** Midpoint jitter, so a gap is exactly halfway between the bounds. */
const fixed = () => 0.5;

function fakeGmail() {
  const sent: string[] = [];
  const create = (ctx: GmailContext) => {
    const client = new GmailClient({ ...ctx, fetchImpl: async () => new Response("{}") });
    client.send = vi.fn(async () => {
      sent.push(`gm_${sent.length + 1}`);
      return { externalMessageId: `gm_${sent.length}`, externalThreadId: "gthread_1" };
    });
    return client;
  };
  return { sent, deps: { clientId: "cid", clientSecret: "sec", tokenKey: key, createClient: create } satisfies SendDeps };
}

async function draft(id: string, over: Partial<typeof t.messages.$inferInsert> = {}) {
  await db.insert(t.messages).values({
    id,
    threadId: FIXTURE_IDS.thread,
    endeavourId: FIXTURE_IDS.endeavour,
    prospectId: FIXTURE_IDS.prospect,
    direction: "outbound",
    messageClass: "new_outreach",
    subject: "Before mainnet",
    body: "Hello",
    sendState: "pending_approval",
    ...over,
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
const setPacing = (pacing: Partial<typeof DEFAULT_PACING>) =>
  db
    .update(t.endeavours)
    .set({ settings: { pacing: { ...DEFAULT_PACING, ...pacing } } })
    .where(eq(t.endeavours.id, FIXTURE_IDS.endeavour));

beforeEach(async () => {
  await truncateAll(handle);
  await seedFixtures(db);
  await db.update(t.mailboxes).set({ tokenCiphertext: sealJson(tokens, key) }).where(eq(t.mailboxes.id, FIXTURE_IDS.mailbox));
  await db.update(t.prospects).set({ stage: "qualified" }).where(eq(t.prospects.id, FIXTURE_IDS.prospect));
  await db.delete(t.messages);
});

describe("approving a draft gives it a slot", () => {
  it("schedules the first message for now and spaces the ones behind it", async () => {
    await setPacing({ minGapMinutes: 10, maxGapMinutes: 10 });
    const first = await draft("msg_1");
    const second = await draft("msg_2");

    await decideApproval(db, { approvalId: first, decision: "approve" }, NOW);
    await decideApproval(db, { approvalId: second, decision: "approve" }, NOW);

    expect((await message("msg_1")).scheduledSendAt).toEqual(NOW);
    expect((await message("msg_2")).scheduledSendAt).toEqual(new Date("2026-09-17T09:10:00Z"));
  });

  it("holds an evening approval until the window opens in the morning", async () => {
    const evening = new Date("2026-09-17T21:30:00Z"); // 22:30 London
    const id = await draft("msg_late");
    await decideApproval(db, { approvalId: id, decision: "approve" }, evening);

    const slot = (await message("msg_late")).scheduledSendAt!;
    expect(hourIn(slot, "Europe/London")).toBe(8);
    expect(slot.getTime()).toBeGreaterThan(evening.getTime());
  });

  it("aims at the recipient's morning when research found their timezone", async () => {
    await db.update(t.companies).set({ timezone: "America/Los_Angeles" }).where(eq(t.companies.id, FIXTURE_IDS.company));
    const id = await draft("msg_west");
    await decideApproval(db, { approvalId: id, decision: "approve" }, NOW);

    // 09:00 UTC is 02:00 in Los Angeles, so it waits for their 08:00.
    const slot = (await message("msg_west")).scheduledSendAt!;
    expect(hourIn(slot, "America/Los_Angeles")).toBe(8);
  });

  it("uses the mailbox's clock when the endeavour has turned recipient timing off", async () => {
    await db.update(t.companies).set({ timezone: "America/Los_Angeles" }).where(eq(t.companies.id, FIXTURE_IDS.company));
    await setPacing({ useRecipientTimezone: false });
    const id = await draft("msg_here");
    await decideApproval(db, { approvalId: id, decision: "approve" }, NOW);
    expect((await message("msg_here")).scheduledSendAt).toEqual(NOW);
  });

  it("keeps a rejected draft out of the queue entirely", async () => {
    const id = await draft("msg_no");
    await decideApproval(db, { approvalId: id, decision: "reject", note: "wrong company" }, NOW);
    expect((await message("msg_no")).scheduledSendAt).toBeNull();
  });
});

describe("sending honours the slot", () => {
  it("sends what is due and leaves what is not", async () => {
    await draft("msg_due", { sendState: "approved", approvedAt: NOW, scheduledSendAt: NOW });
    await draft("msg_later", {
      sendState: "approved",
      approvedAt: NOW,
      scheduledSendAt: new Date("2026-09-17T15:00:00Z"),
    });

    const { sent, deps } = fakeGmail();
    const outcome = await sendApprovedForMailbox(db, deps, { mailboxId: FIXTURE_IDS.mailbox, now: NOW });

    expect(outcome).toMatchObject({ sent: 1, waiting: 1 });
    expect(sent).toHaveLength(1);
    expect((await message("msg_due")).sendState).toBe("sent");
    expect((await message("msg_later")).sendState).toBe("approved");
  });

  it("says it is waiting rather than claiming there was nothing to send", async () => {
    await draft("msg_later", {
      sendState: "approved",
      approvedAt: NOW,
      scheduledSendAt: new Date("2026-09-17T15:00:00Z"),
    });
    const { deps } = fakeGmail();
    expect(await sendApprovedForMailbox(db, deps, { mailboxId: FIXTURE_IDS.mailbox, now: NOW })).toMatchObject({
      sent: 0,
      waiting: 1,
      skipped: "waiting_for_slot",
    });
  });

  it("sends a message that never got a slot rather than holding it forever", async () => {
    await draft("msg_orphan", { sendState: "approved", approvedAt: NOW, scheduledSendAt: null });
    const { deps } = fakeGmail();
    expect(await sendApprovedForMailbox(db, deps, { mailboxId: FIXTURE_IDS.mailbox, now: NOW })).toMatchObject({ sent: 1 });
  });
});

describe("a reply waits a decent interval", () => {
  it("is not sent seconds after the message it answers", async () => {
    await db.insert(t.messages).values({
      id: "in_1",
      threadId: FIXTURE_IDS.thread,
      endeavourId: FIXTURE_IDS.endeavour,
      prospectId: FIXTURE_IDS.prospect,
      direction: "inbound",
      subject: "Re: Before mainnet",
      body: "Interested — what would it cost?",
      receivedAt: new Date("2026-09-17T08:55:00Z"),
    });
    await draft("msg_reply", { messageClass: "reply", sendState: "approved", approvedAt: NOW });
    await scheduleSend(db, { messageId: "msg_reply", now: NOW, random: fixed });

    // Their message landed at 08:55; the default delay is 90 minutes.
    expect((await message("msg_reply")).scheduledSendAt).toEqual(new Date("2026-09-17T10:25:00Z"));
  });
});
