import { randomBytes } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { sealJson } from "../../src/server/crypto/tokens";
import { FIXTURE_IDS, seedFixtures } from "../../src/server/db/fixtures";
import * as t from "../../src/server/db/schema";
import { GmailClient, type GmailContext, type GmailMessage } from "../../src/server/mailboxes/gmail";
import { addressOf, ingestReplies, nameOf, type IngestDeps } from "../../src/server/mailboxes/ingest";
import { testDb, truncateAll } from "./helpers";

const handle = testDb();
const db = handle.db;
afterAll(() => handle.close());

const key = randomBytes(32);
const NOW = new Date("2026-09-18T09:00:00Z");
const tokens = { accessToken: "at", refreshToken: "rt", expiresAt: NOW.getTime() + 600_000, scope: "gmail" };
const encode = (text: string) => Buffer.from(text, "utf8").toString("base64url");

function gmailMessage(over: Partial<GmailMessage> & { from?: string; subject?: string; body?: string } = {}): GmailMessage {
  const { from = "Ilse Vermeer <ilse@northbridge.example>", subject = "Re: Bridge contract", body = "Yes, Friday works.", ...rest } = over;
  return {
    id: "gm_reply_1",
    threadId: "gthread_1",
    labelIds: ["INBOX"],
    internalDate: String(NOW.getTime()),
    payload: {
      headers: [
        { name: "From", value: from },
        { name: "Subject", value: subject },
      ],
      body: { data: encode(body) },
    },
    ...rest,
  };
}

function fakeGmail(messages: GmailMessage[]) {
  const create = (ctx: GmailContext) => {
    const client = new GmailClient({ ...ctx, fetchImpl: async () => new Response("{}") });
    client.list = vi.fn(async () => messages.map((m) => ({ id: m.id, threadId: m.threadId })));
    client.get = vi.fn(async (id: string) => messages.find((m) => m.id === id)!);
    return client;
  };
  return { clientId: "cid", clientSecret: "sec", tokenKey: key, createClient: create } satisfies IngestDeps;
}

const ingest = (deps: IngestDeps) => ingestReplies(db, deps, { mailboxId: FIXTURE_IDS.mailbox, now: NOW });

beforeEach(async () => {
  await truncateAll(handle);
  await seedFixtures(db);
  await db.update(t.mailboxes).set({ tokenCiphertext: sealJson(tokens, key) }).where(eq(t.mailboxes.id, FIXTURE_IDS.mailbox));
  await db.update(t.threads).set({ externalThreadId: "gthread_1", unread: false }).where(eq(t.threads.id, FIXTURE_IDS.thread));
  await db.update(t.prospects).set({ stage: "contacted" }).where(eq(t.prospects.id, FIXTURE_IDS.prospect));
});

describe("header parsing", () => {
  it("pulls the address and name out of a From header", () => {
    expect(addressOf("Ilse Vermeer <Ilse@Northbridge.example>")).toBe("ilse@northbridge.example");
    expect(addressOf("plain@example.com")).toBe("plain@example.com");
    expect(addressOf(null)).toBeNull();
    expect(nameOf("Ilse Vermeer <ilse@x.com>")).toBe("Ilse Vermeer");
    expect(nameOf("ilse@x.com")).toBeNull();
  });
});

describe("ingestReplies", () => {
  it("attaches a reply to the thread it belongs to and moves the prospect to replied", async () => {
    const result = await ingest(fakeGmail([gmailMessage()]));
    expect(result).toMatchObject({ fetched: 1, stored: 1, matched: 1, needsReview: 0 });

    const inbound = await db.select().from(t.messages).where(eq(t.messages.direction, "inbound"));
    expect(inbound).toHaveLength(2); // the fixture reply plus this one
    const stored = inbound.find((m) => m.externalMessageId === "gm_reply_1")!;
    expect(stored).toMatchObject({ threadId: FIXTURE_IDS.thread, prospectId: FIXTURE_IDS.prospect, body: "Yes, Friday works." });

    const [prospect] = await db.select().from(t.prospects).where(eq(t.prospects.id, FIXTURE_IDS.prospect));
    expect(prospect).toMatchObject({ stage: "replied", nextAction: "Reply received: decide the response" });
    const [thread] = await db.select().from(t.threads).where(eq(t.threads.id, FIXTURE_IDS.thread));
    expect(thread!.unread).toBe(true);
    expect((await db.select().from(t.events)).map((e) => e.eventType)).toContain("message.received");
  });

  it("matches by sender when the thread is new", async () => {
    const result = await ingest(fakeGmail([gmailMessage({ id: "gm_new", threadId: "gthread_new" })]));
    expect(result).toMatchObject({ matched: 1, needsReview: 0 });
    const [thread] = await db.select().from(t.threads).where(eq(t.threads.externalThreadId, "gthread_new"));
    expect(thread).toMatchObject({ mappingState: "mapped", prospectId: FIXTURE_IDS.prospect });
  });

  it("queues an unrecognised sender for review instead of guessing", async () => {
    const result = await ingest(
      fakeGmail([gmailMessage({ id: "gm_stranger", threadId: "gthread_stranger", from: "Someone Else <who@elsewhere.example>" })]),
    );
    expect(result).toMatchObject({ stored: 1, matched: 0, needsReview: 1 });

    const [thread] = await db.select().from(t.threads).where(eq(t.threads.externalThreadId, "gthread_stranger"));
    expect(thread).toMatchObject({ mappingState: "needs_review", prospectId: null });
    const [approval] = await db.select().from(t.approvals).where(eq(t.approvals.kind, "thread_mapping"));
    expect(approval).toMatchObject({ status: "pending", subjectId: thread!.id });
    expect(approval!.payload).toMatchObject({ from: "who@elsewhere.example" });
  });

  it("never stores the same Gmail message twice", async () => {
    const deps = fakeGmail([gmailMessage()]);
    await ingest(deps);
    const again = await ingest(deps);
    expect(again).toMatchObject({ stored: 0, alreadyKnown: 1 });
  });

  it("reads plain text from a multipart reply", async () => {
    const multipart = gmailMessage({
      id: "gm_multi",
      threadId: "gthread_multi",
      payload: {
        headers: [{ name: "From", value: "Ilse Vermeer <ilse@northbridge.example>" }, { name: "Subject", value: "Re: Bridge" }],
        parts: [
          { mimeType: "text/html", body: { data: encode("<p>ignore me</p>") } },
          { mimeType: "text/plain", body: { data: encode("Costs look fine.") } },
        ],
      },
    });
    await ingest(fakeGmail([multipart]));
    const [stored] = await db.select().from(t.messages).where(eq(t.messages.externalMessageId, "gm_multi"));
    expect(stored!.body).toBe("Costs look fine.");
  });
});
