import { randomBytes } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createMailboxAlias, setEndeavourFromAlias, ALIAS_CONSENT_NEEDED, type AliasDeps } from "../../src/server/commands/alias";
import { CommandError } from "../../src/server/commands/errors";
import { ALIAS_SCOPES, GMAIL_SCOPES } from "../../src/server/commands/mailboxes";
import { sendApprovedForMailbox, type SendDeps } from "../../src/server/commands/send";
import { sealJson, unsealJson } from "../../src/server/crypto/tokens";
import { FIXTURE_IDS, seedFixtures } from "../../src/server/db/fixtures";
import * as t from "../../src/server/db/schema";
import { GmailClient, GmailError, type GmailContext } from "../../src/server/mailboxes/gmail";
import { decodeRawMessage } from "../../src/server/mailboxes/message";
import { testDb, truncateAll } from "./helpers";

const handle = testDb();
const db = handle.db;
afterAll(() => handle.close());

const key = randomBytes(32);
const NOW = new Date("2026-09-17T10:00:00Z");
const fullScope = [...GMAIL_SCOPES, ...ALIAS_SCOPES].join(" ");
const tokensFor = (scope: string) => ({ accessToken: "at", refreshToken: "rt", expiresAt: NOW.getTime() + 600_000, scope });

/** A Google that records both alias calls, and can be told to refuse either of them. */
function fakeGoogle(behaviour: { aliasError?: GmailError; sendAsError?: GmailError; verification?: string } = {}) {
  const calls: string[] = [];
  const create = (ctx: GmailContext) => {
    const client = new GmailClient({ ...ctx, fetchImpl: async () => new Response("{}") });
    client.createDomainAlias = vi.fn(async (userKey: string, alias: string) => {
      calls.push(`alias:${userKey}:${alias}`);
      if (behaviour.aliasError) throw behaviour.aliasError;
      return alias;
    });
    client.createSendAs = vi.fn(async (address: string, displayName: string) => {
      calls.push(`sendAs:${address}`);
      if (behaviour.sendAsError) throw behaviour.sendAsError;
      return { sendAsEmail: address, displayName, isDefault: false, verificationStatus: behaviour.verification ?? "accepted" };
    });
    return client;
  };
  return { calls, deps: { clientId: "cid", clientSecret: "sec", tokenKey: key, createClient: create } satisfies AliasDeps };
}

const mailbox = async () => (await db.select().from(t.mailboxes).where(eq(t.mailboxes.id, FIXTURE_IDS.mailbox)))[0]!;
const create = (deps: AliasDeps, over: Partial<{ localPart: string; displayName: string }> = {}) =>
  createMailboxAlias(db, deps, { mailboxId: FIXTURE_IDS.mailbox, localPart: "hello", displayName: "Max at Consulting", ...over }, NOW);

async function expectCode(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toBeInstanceOf(CommandError);
  await expect(p).rejects.toMatchObject({ code });
}

beforeEach(async () => {
  await truncateAll(handle);
  await seedFixtures(db);
  await db
    .update(t.mailboxes)
    .set({ tokenCiphertext: sealJson(tokensFor(fullScope), key) })
    .where(eq(t.mailboxes.id, FIXTURE_IDS.mailbox));
});

describe("createMailboxAlias", () => {
  it("creates the alias on the domain, registers the send-as and records it", async () => {
    const { calls, deps } = fakeGoogle();
    const result = await create(deps);

    expect(result).toMatchObject({ sendAsReady: true, alias: { address: "hello@consulting.example" } });
    expect(calls).toEqual([
      "alias:max@consulting.example:hello@consulting.example",
      "sendAs:hello@consulting.example",
    ]);
    expect((await mailbox()).aliases).toEqual([
      { address: "hello@consulting.example", displayName: "Max at Consulting", createdAt: NOW.toISOString() },
    ]);
    const [event] = await db.select().from(t.events).where(eq(t.events.eventType, "mailbox.alias_created"));
    expect(event!.payload).toMatchObject({ subject: "hello@consulting.example", sendAsReady: true });
  });

  it("keeps the alias when Gmail has not accepted it yet, and says so", async () => {
    const { deps } = fakeGoogle({ sendAsError: new GmailError("registering the send-as address failed (403): nope", 403, false) });
    const result = await create(deps);

    expect(result.sendAsReady).toBe(false);
    expect((await mailbox()).aliases).toHaveLength(1);
    const [event] = await db.select().from(t.events).where(eq(t.events.eventType, "mailbox.alias_created"));
    expect(event!.payload).toMatchObject({ detail: expect.stringContaining("403") });
  });

  it("carries on when the address already exists on the domain", async () => {
    const { calls, deps } = fakeGoogle({ aliasError: new GmailError("already exists", 409, false) });
    await expect(create(deps)).resolves.toMatchObject({ sendAsReady: true });
    expect(calls).toContain("sendAs:hello@consulting.example");
  });

  it("gives up on an error that is not a duplicate, and records nothing", async () => {
    const { deps } = fakeGoogle({ aliasError: new GmailError("not authorized", 403, false) });
    await expect(create(deps)).rejects.toThrow("not authorized");
    expect((await mailbox()).aliases).toEqual([]);
    expect(await db.select().from(t.events).where(eq(t.events.eventType, "mailbox.alias_created"))).toEqual([]);
  });

  it("asks for consent it does not have instead of calling Google", async () => {
    await db
      .update(t.mailboxes)
      .set({ tokenCiphertext: sealJson(tokensFor(GMAIL_SCOPES.join(" ")), key) })
      .where(eq(t.mailboxes.id, FIXTURE_IDS.mailbox));
    const { calls, deps } = fakeGoogle();
    await expectCode(create(deps), "conflict");
    await expect(create(deps)).rejects.toThrow(ALIAS_CONSENT_NEEDED);
    expect(calls).toEqual([]);
  });

  it("refuses an address the rules reject before Google is asked", async () => {
    const { calls, deps } = fakeGoogle();
    await expectCode(create(deps, { localPart: "not valid" }), "invalid");
    await expectCode(create(deps, { localPart: "max" }), "invalid");
    expect(calls).toEqual([]);
  });

  it("will not create an address the mailbox already sends as", async () => {
    const { deps } = fakeGoogle();
    await create(deps);
    await expectCode(create(deps, { displayName: "Max K" }), "invalid");
    expect((await mailbox()).aliases).toHaveLength(1);
  });

  it("re-seals the token set when Google refreshed it mid-flight", async () => {
    const { deps } = fakeGoogle();
    const create2 = { ...deps, createClient: (ctx: GmailContext) => {
      const client = deps.createClient!(ctx);
      Object.defineProperty(client, "tokensChanged", { get: () => true });
      Object.defineProperty(client, "currentTokens", { get: () => ({ ...ctx.tokens, accessToken: "refreshed" }) });
      return client;
    } } satisfies AliasDeps;
    await createMailboxAlias(db, create2, { mailboxId: FIXTURE_IDS.mailbox, localPart: "hi", displayName: "Max" }, NOW);
    const stored = unsealJson<{ accessToken: string }>((await mailbox()).tokenCiphertext!, key);
    expect(stored.accessToken).toBe("refreshed");
  });
});

describe("setEndeavourFromAlias", () => {
  beforeEach(async () => {
    const { deps } = fakeGoogle();
    await create(deps);
  });

  it("sends under the alias once the endeavour is set to it", async () => {
    await setEndeavourFromAlias(db, { endeavourId: FIXTURE_IDS.endeavour, alias: "hello@consulting.example" });
    await db.update(t.prospects).set({ stage: "qualified" }).where(eq(t.prospects.id, FIXTURE_IDS.prospect));
    await db.insert(t.messages).values({
      id: "msg_alias",
      threadId: FIXTURE_IDS.thread,
      endeavourId: FIXTURE_IDS.endeavour,
      prospectId: FIXTURE_IDS.prospect,
      direction: "outbound",
      messageClass: "new_outreach",
      subject: "Before mainnet",
      body: "Hello",
      sendState: "approved",
      approvedAt: new Date("2026-09-17T09:00:00Z"),
    });

    const sent: string[] = [];
    const sendDeps = {
      clientId: "cid",
      clientSecret: "sec",
      tokenKey: key,
      createClient: (ctx: GmailContext) => {
        const client = new GmailClient({ ...ctx, fetchImpl: async () => new Response("{}") });
        client.send = vi.fn(async (raw: string) => {
          sent.push(decodeRawMessage(raw));
          return { externalMessageId: "gm_1", externalThreadId: "gthread_1" };
        });
        return client;
      },
    } satisfies SendDeps;

    const outcome = await sendApprovedForMailbox(db, sendDeps, { mailboxId: FIXTURE_IDS.mailbox, now: NOW });
    expect(outcome.sent).toBe(1);
    expect(sent[0]).toContain("From: Max at Consulting <hello@consulting.example>");
    expect(sent[0]).toContain("hello@consulting.example");
  });

  it("refuses an address the mailbox cannot send as, and clears back to the account", async () => {
    await expectCode(setEndeavourFromAlias(db, { endeavourId: FIXTURE_IDS.endeavour, alias: "nope@consulting.example" }), "invalid");
    await setEndeavourFromAlias(db, { endeavourId: FIXTURE_IDS.endeavour, alias: "hello@consulting.example" });
    await setEndeavourFromAlias(db, { endeavourId: FIXTURE_IDS.endeavour, alias: null });
    const [endeavour] = await db.select().from(t.endeavours).where(eq(t.endeavours.id, FIXTURE_IDS.endeavour));
    expect(endeavour!.fromAlias).toBeNull();
  });
});
