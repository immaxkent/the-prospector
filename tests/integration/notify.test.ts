import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DEDUPE_WINDOW_MS, markAllNotificationsRead, markNotificationRead, notify, unreadNotifications } from "../../src/server/commands/notify";
import { FIXTURE_IDS, seedFixtures } from "../../src/server/db/fixtures";
import * as t from "../../src/server/db/schema";
import { inAppOnly, ntfyChannel, webhookChannel, type Fetch } from "../../src/server/notify/channels";
import { testDb, truncateAll } from "./helpers";

const handle = testDb();
const db = handle.db;
afterAll(() => handle.close());
beforeEach(async () => {
  await truncateAll(handle);
  await seedFixtures(db);
});

const NOW = new Date("2026-09-18T09:00:00Z");
const message = { kind: "run_failed", title: "Daily run failed", body: "Research could not reach the search provider", endeavourId: FIXTURE_IDS.endeavour };

describe("notify", () => {
  it("records a notification and marks it delivered", async () => {
    const fetchImpl = vi.fn<Fetch>(async () => new Response("ok"));
    const result = await notify(db, ntfyChannel("https://ntfy.sh/prospector", fetchImpl), message, NOW);
    expect(result).toMatchObject({ delivered: true, error: null });

    const [row] = await db.select().from(t.notifications);
    expect(row).toMatchObject({ kind: "run_failed", title: "Daily run failed", deliveredAt: NOW, readAt: null });
    const [, init] = fetchImpl.mock.calls[0]!;
    expect((init!.headers as Record<string, string>)["title"]).toBe("Daily run failed");
    expect(init!.body).toContain("search provider");
  });

  it("keeps the notification when delivery fails, and says why", async () => {
    const result = await notify(db, ntfyChannel("https://ntfy.sh/x", async () => new Response("no", { status: 500 })), message, NOW);
    expect(result).toMatchObject({ delivered: false });
    expect(result!.error).toContain("500");
    const [row] = await db.select().from(t.notifications);
    expect(row!.deliveredAt).toBeNull();
  });

  it("does not repeat the same notification within the window", async () => {
    await notify(db, inAppOnly, message, NOW);
    expect(await notify(db, inAppOnly, message, new Date(NOW.getTime() + 60_000))).toBeNull();
    expect(await notify(db, inAppOnly, message, new Date(NOW.getTime() + DEDUPE_WINDOW_MS + 1000))).not.toBeNull();
    expect(await db.select().from(t.notifications)).toHaveLength(2);
  });

  it("posts JSON to a webhook", async () => {
    const fetchImpl = vi.fn<Fetch>(async () => new Response("ok"));
    await notify(db, webhookChannel("https://example.com/hook", fetchImpl), message, NOW);
    expect(JSON.parse(fetchImpl.mock.calls[0]![1]!.body as string)).toMatchObject({ kind: "run_failed" });
  });

  it("lists unread notifications and marks them read", async () => {
    await notify(db, inAppOnly, message, NOW);
    await notify(db, inAppOnly, { ...message, kind: "mailbox", title: "Mailbox needs reconnecting" }, NOW);
    expect(await unreadNotifications(db)).toHaveLength(2);

    const [first] = await unreadNotifications(db);
    await markNotificationRead(db, { id: first!.id });
    expect(await unreadNotifications(db)).toHaveLength(1);

    expect(await markAllNotificationsRead(db)).toEqual({ marked: 1 });
    expect(await unreadNotifications(db)).toHaveLength(0);
    await expect(markNotificationRead(db, { id: "ntf_missing" })).rejects.toMatchObject({ code: "not_found" });
  });
});
