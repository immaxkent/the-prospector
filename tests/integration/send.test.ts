import { randomBytes } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { sendApprovedForMailbox, type SendDeps } from "../../src/server/commands/send";
import { sealJson } from "../../src/server/crypto/tokens";
import { FIXTURE_IDS, seedFixtures } from "../../src/server/db/fixtures";
import * as t from "../../src/server/db/schema";
import { GmailClient, GmailError, type GmailContext } from "../../src/server/mailboxes/gmail";
import { decodeRawMessage } from "../../src/server/mailboxes/message";
import { testDb, truncateAll } from "./helpers";

const handle = testDb();
const db = handle.db;
afterAll(() => handle.close());

const key = randomBytes(32);
// 10:00 UTC is 11:00 in London: inside working hours, outside the 20:00-07:00 quiet window.
const NOW = new Date("2026-09-17T10:00:00Z");
const tokens = { accessToken: "at", refreshToken: "rt", expiresAt: NOW.getTime() + 600_000, scope: "gmail" };

/** A Gmail client that records what it was asked to send. */
function fakeGmail(behaviour: { fail?: GmailError; raws?: string[] } = {}) {
  const sent: { raw: string; threadId?: string | null | undefined }[] = [];
  const create = (ctx: GmailContext) => {
    const client = new GmailClient({ ...ctx, fetchImpl: async () => new Response("{}") });
    client.send = vi.fn(async (raw: string, threadId?: string | null) => {
      if (behaviour.fail) throw behaviour.fail;
      sent.push({ raw, threadId });
      return { externalMessageId: `gm_${sent.length}`, externalThreadId: "gthread_1" };
    });
    return client;
  };
  return { sent, deps: { clientId: "cid", clientSecret: "sec", tokenKey: key, createClient: create } satisfies SendDeps };
}

async function approvedMessage(id = "msg_approved") {
  await db.insert(t.messages).values({
    id,
    threadId: FIXTURE_IDS.thread,
    endeavourId: FIXTURE_IDS.endeavour,
    prospectId: FIXTURE_IDS.prospect,
    direction: "outbound",
    messageClass: "new_outreach",
    subject: "Bridge contract before mainnet",
    body: "Your postmortem mentions missing invariant tests.",
    sendState: "approved",
    approvedAt: new Date("2026-09-17T09:00:00Z"),
  });
  return id;
}

const message = async (id: string) => (await db.select().from(t.messages).where(eq(t.messages.id, id)))[0]!;
const send = (deps: SendDeps, now = NOW) => sendApprovedForMailbox(db, deps, { mailboxId: FIXTURE_IDS.mailbox, now });

beforeEach(async () => {
  await truncateAll(handle);
  await seedFixtures(db);
  await db
    .update(t.mailboxes)
    .set({ tokenCiphertext: sealJson(tokens, key) })
    .where(eq(t.mailboxes.id, FIXTURE_IDS.mailbox));
  await db.update(t.prospects).set({ stage: "qualified" }).where(eq(t.prospects.id, FIXTURE_IDS.prospect));
});

describe("sendApprovedForMailbox", () => {
  it("sends an approved message and records what happened", async () => {
    const id = await approvedMessage();
    const { sent, deps } = fakeGmail();
    const outcome = await send(deps);

    expect(outcome).toMatchObject({ sent: 1, failed: 0, suppressed: 0, skipped: null });
    expect(await message(id)).toMatchObject({ sendState: "sent", externalMessageId: "gm_1", sendAttempts: 1, sentAt: NOW });

    const raw = decodeRawMessage(sent[0]!.raw);
    expect(raw).toContain("To: Ilse Vermeer <ilse@northbridge.example>");
    expect(raw).toContain("List-Unsubscribe:");

    const [thread] = await db.select().from(t.threads).where(eq(t.threads.id, FIXTURE_IDS.thread));
    expect(thread!.externalThreadId).toBe("gthread_1");
    const [prospect] = await db.select().from(t.prospects).where(eq(t.prospects.id, FIXTURE_IDS.prospect));
    expect(prospect).toMatchObject({ stage: "contacted", nextAction: "Awaiting reply" });
    expect((await db.select().from(t.events)).map((e) => e.eventType)).toContain("message.sent");
  });

  it("sends nothing during quiet hours", async () => {
    await approvedMessage();
    const { sent, deps } = fakeGmail();
    // 21:00 UTC is 22:00 in London, inside the 20:00-07:00 quiet window.
    expect(await send(deps, new Date("2026-09-17T21:00:00Z"))).toMatchObject({ sent: 0, skipped: "quiet_hours" });
    expect(sent).toHaveLength(0);
  });

  it("stops at the mailbox cap, counting what was already sent today", async () => {
    await db
      .update(t.mailboxes)
      .set({ limits: { dailyCap: 1, weeklyCap: 10, warmup: null, quietHours: { start: 20, end: 7 }, timezone: "Europe/London" } })
      .where(eq(t.mailboxes.id, FIXTURE_IDS.mailbox));
    await db.update(t.messages).set({ sentAt: NOW }).where(eq(t.messages.id, FIXTURE_IDS.outbound));
    await approvedMessage();

    const { sent, deps } = fakeGmail();
    expect(await send(deps)).toMatchObject({ sent: 0, skipped: "no_capacity", capacity: 0 });
    expect(sent).toHaveLength(0);
  });

  it("never sends to a suppressed address", async () => {
    const id = await approvedMessage();
    await db.insert(t.suppressions).values({ id: "sup_1", kind: "domain", value: "northbridge.example", reason: "asked to stop" });
    const { sent, deps } = fakeGmail();
    expect(await send(deps)).toMatchObject({ sent: 0, suppressed: 1 });
    expect(sent).toHaveLength(0);
    expect(await message(id)).toMatchObject({ sendState: "rejected" });
  });

  it("keeps a temporary failure retryable and records the reason", async () => {
    const id = await approvedMessage();
    const { deps } = fakeGmail({ fail: new GmailError("rate limited", 429, true) });
    expect(await send(deps)).toMatchObject({ sent: 0, failed: 1 });
    const row = await message(id);
    expect(row).toMatchObject({ sendState: "approved", sendAttempts: 1 });
    expect(row.lastError).toContain("rate limited");
  });

  it("marks the mailbox for reconnection when Gmail rejects the credentials", async () => {
    const id = await approvedMessage();
    const { deps } = fakeGmail({ fail: new GmailError("unauthorised", 401, false) });
    await send(deps);
    expect(await message(id)).toMatchObject({ sendState: "failed" });
    const [mailbox] = await db.select().from(t.mailboxes).where(eq(t.mailboxes.id, FIXTURE_IDS.mailbox));
    expect(mailbox!.status).toBe("needs_reauth");
  });

  it("does nothing when the mailbox is disconnected or has nothing approved", async () => {
    const { deps } = fakeGmail();
    expect(await send(deps)).toMatchObject({ sent: 0, skipped: "nothing_approved" });
    await db.update(t.mailboxes).set({ status: "disconnected" }).where(eq(t.mailboxes.id, FIXTURE_IDS.mailbox));
    await expect(send(deps)).rejects.toMatchObject({ code: "conflict" });
  });
});
