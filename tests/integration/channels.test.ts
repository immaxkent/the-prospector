import { randomBytes } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { connectChannel, deliveryChannel, disconnectChannel, listChannels, testChannel, type ChannelDeps } from "../../src/server/commands/channels";
import { CommandError } from "../../src/server/commands/errors";
import { unsealJson } from "../../src/server/crypto/tokens";
import * as t from "../../src/server/db/schema";
import type { Fetch } from "../../src/server/notify/channels";
import { testDb, truncateAll } from "./helpers";

const handle = testDb();
const db = handle.db;
afterAll(() => handle.close());

const key = randomBytes(32);
const NOW = new Date("2026-09-25T10:00:00Z");
const HOOK = "https://hooks.slack.com/services/T0/B0/xxxx";

/** A provider that answers however the test wants, and remembers what it was sent. */
function provider(ok = true) {
  const calls: { url: string; body: unknown }[] = [];
  const impl: Fetch = async (url, init) => {
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
    return { ok, status: ok ? 200 : 403, text: async () => (ok ? "ok" : JSON.stringify({ description: "chat not found" })) } as Response;
  };
  return { calls, deps: { tokenKey: key, appUrl: "https://prospector.example", fetchImpl: impl } satisfies ChannelDeps };
}

async function expectCode(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toBeInstanceOf(CommandError);
  await expect(p).rejects.toMatchObject({ code });
}

beforeEach(() => truncateAll(handle));

describe("connectChannel", () => {
  it("proves the credential works before storing it", async () => {
    const { calls, deps } = provider();
    const result = await connectChannel(db, deps, { provider: "slack", values: { webhookUrl: HOOK } }, NOW);

    // The test send happens first: a credential that has never delivered is worse than none.
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(HOOK);
    expect(result).toMatchObject({ provider: "slack", label: "hooks.slack.com" });

    const [row] = await db.select().from(t.notificationChannels);
    expect(row!.enabled).toBe(true);
    expect(row!.lastDeliveredAt).toEqual(NOW);
    // The secret is sealed, never stored in the clear.
    expect(row!.secretCiphertext).not.toContain("hooks.slack.com");
    expect(unsealJson<Record<string, string>>(row!.secretCiphertext, key)).toEqual({ webhookUrl: HOOK });
  });

  it("stores nothing when the provider refuses", async () => {
    const { deps } = provider(false);
    await expect(
      connectChannel(db, deps, { provider: "telegram", values: { botToken: "123456:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw", chatId: "9" } }, NOW),
    ).rejects.toThrow("chat not found");
    expect(await db.select().from(t.notificationChannels)).toEqual([]);
  });

  it("refuses a credential of the wrong shape without troubling the provider", async () => {
    const { calls, deps } = provider();
    await expectCode(connectChannel(db, deps, { provider: "slack", values: { webhookUrl: "https://example.com/x" } }, NOW), "invalid");
    await expectCode(connectChannel(db, deps, { provider: "carrier_pigeon", values: {} }, NOW), "invalid");
    expect(calls).toEqual([]);
  });

  it("records the connection as an event, naming the channel but not the secret", async () => {
    const { deps } = provider();
    await connectChannel(db, deps, { provider: "slack", values: { webhookUrl: HOOK } }, NOW);
    const [event] = await db.select().from(t.events).where(eq(t.events.eventType, "notification_channel.connected"));
    expect(event!.payload).toMatchObject({ subject: "slack · hooks.slack.com" });
    expect(JSON.stringify(event!.payload)).not.toContain("xxxx");
  });
});

describe("listChannels", () => {
  it("shows what a channel points at and never the credential", async () => {
    const { deps } = provider();
    await connectChannel(db, deps, { provider: "slack", values: { webhookUrl: HOOK } }, NOW);
    const [summary] = await listChannels(db);
    expect(summary).toMatchObject({ provider: "slack", label: "hooks.slack.com", enabled: true });
    expect(JSON.stringify(summary)).not.toContain("xxxx");
  });
});

describe("testChannel", () => {
  it("records when a test arrives", async () => {
    const { deps } = provider();
    const { id } = await connectChannel(db, deps, { provider: "slack", values: { webhookUrl: HOOK } }, NOW);
    const later = new Date("2026-09-25T12:00:00Z");
    expect(await testChannel(db, deps, { channelId: id }, later)).toEqual({ delivered: true });
    const [row] = await db.select().from(t.notificationChannels);
    expect(row!.lastDeliveredAt).toEqual(later);
    expect(row!.lastError).toBeNull();
  });

  it("keeps the reason on the channel when a test fails, so a dead channel is visible", async () => {
    const good = provider();
    const { id } = await connectChannel(db, good.deps, { provider: "slack", values: { webhookUrl: HOOK } }, NOW);
    const bad = provider(false);
    await expect(testChannel(db, bad.deps, { channelId: id }, NOW)).rejects.toThrow();
    const [row] = await db.select().from(t.notificationChannels);
    expect(row!.lastError).toContain("403");
  });
});

describe("disconnectChannel", () => {
  it("removes it and says so", async () => {
    const { deps } = provider();
    const { id } = await connectChannel(db, deps, { provider: "slack", values: { webhookUrl: HOOK } }, NOW);
    await disconnectChannel(db, { channelId: id });
    expect(await db.select().from(t.notificationChannels)).toEqual([]);
    const events = await db.select().from(t.events).where(eq(t.events.eventType, "notification_channel.disconnected"));
    expect(events).toHaveLength(1);
  });

  it("refuses one that is not there", async () => {
    await expectCode(disconnectChannel(db, { channelId: "nch_nope" }), "not_found");
  });
});

describe("deliveryChannel", () => {
  it("sends to every connected channel", async () => {
    const { calls, deps } = provider();
    await connectChannel(db, deps, { provider: "slack", values: { webhookUrl: HOOK } }, NOW);
    await connectChannel(db, deps, { provider: "telegram", values: { botToken: "123456:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw", chatId: "9" } }, NOW);
    calls.length = 0;

    const channel = await deliveryChannel(db, deps);
    await channel.deliver({ kind: "k", title: "T", body: "B" });
    expect(calls.map((c) => new URL(c.url).host).sort()).toEqual(["api.telegram.org", "hooks.slack.com"]);
  });

  it("falls back to however the box was configured before, when nothing is connected", async () => {
    const { deps } = provider();
    const log: string[] = [];
    const channel = await deliveryChannel(db, { ...deps, fromEnv: { name: "env", deliver: async () => { log.push("env"); } } });
    await channel.deliver({ kind: "k", title: "T", body: "B" });
    expect(log).toEqual(["env"]);
  });
});
