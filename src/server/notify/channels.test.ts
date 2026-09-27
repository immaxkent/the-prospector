import { describe, expect, it } from "vitest";
import type { AppConfig } from "../config";
import {
  channelFor,
  channelFromCredentials,
  escapeMarkdown,
  fanOut,
  inAppOnly,
  isSlackWebhookUrl,
  ntfyChannel,
  slackChannel,
  telegramChannel,
  webhookChannel,
  type DeliveryChannel,
  type Fetch,
  type Notification,
} from "./channels";

const HOOK = "https://hooks.slack.com/services/T0/B0/xxxx";

const notification: Notification = {
  kind: "approval_waiting",
  title: "3 drafts waiting for you",
  body: "Northbridge, Vela and Arbor are ready to send.",
  endeavourId: "end_1",
  path: "/command",
  priority: "high",
};

/** Records what was posted and answers with whatever the test asks for. */
function recorder(response: Partial<{ ok: boolean; status: number; body: string }> = {}) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const impl: Fetch = async (url, init) => {
    calls.push({ url, init });
    return {
      ok: response.ok ?? true,
      status: response.status ?? 200,
      text: async () => response.body ?? "ok",
    } as Response;
  };
  return { calls, impl };
}

const bodyOf = (init?: RequestInit) => JSON.parse(String(init?.body));

describe("slackChannel", () => {
  it("posts a header, the body and a link back into the app", async () => {
    const { calls, impl } = recorder();
    await slackChannel(HOOK, "https://prospector.example", impl).deliver(notification);

    expect(calls[0]!.url).toBe(HOOK);
    const posted = bodyOf(calls[0]!.init);
    expect(posted.text).toContain("3 drafts waiting for you");
    expect(posted.blocks[0]).toMatchObject({ type: "header", text: { text: "3 drafts waiting for you" } });
    expect(posted.blocks[1].text.text).toContain("Northbridge");
    expect(posted.blocks[2].elements[0].text).toContain("<https://prospector.example/command|Open in The Prospector>");
    expect(posted.blocks[2].elements[0].text).toContain("Needs you");
  });

  it("leaves out the link when the app has no public address", async () => {
    const { calls, impl } = recorder();
    await slackChannel(HOOK, "", impl).deliver(notification);
    expect(JSON.stringify(bodyOf(calls[0]!.init))).not.toContain("Open in The Prospector");
  });

  it("keeps Slack's own reason when it refuses, so the failure is diagnosable", async () => {
    const { impl } = recorder({ ok: false, status: 404, body: "no_service" });
    await expect(slackChannel(HOOK, "", impl).deliver(notification)).rejects.toThrow("Slack returned 404: no_service");
  });

  it("truncates a body Slack would reject rather than failing to deliver it", async () => {
    const { calls, impl } = recorder();
    await slackChannel(HOOK, "", impl).deliver({ ...notification, body: "x".repeat(5000) });
    expect(bodyOf(calls[0]!.init).blocks[1].text.text.length).toBe(2900);
  });
});

describe("isSlackWebhookUrl", () => {
  it("accepts a Slack hook and rejects anything else", () => {
    expect(isSlackWebhookUrl(HOOK)).toBe(true);
    expect(isSlackWebhookUrl("https://hooks.slack.com.evil.example/services/x")).toBe(false);
    expect(isSlackWebhookUrl("http://hooks.slack.com/services/x")).toBe(false);
    expect(isSlackWebhookUrl("https://example.com/hook")).toBe(false);
  });
});

describe("ntfyChannel and webhookChannel", () => {
  it("ntfy sends the title as a header and the body as the payload", async () => {
    const { calls, impl } = recorder();
    await ntfyChannel("https://ntfy.sh/topic", impl).deliver(notification);
    expect(calls[0]!.init?.headers).toMatchObject({ title: notification.title, priority: "high", click: "/command" });
    expect(calls[0]!.init?.body).toBe(notification.body);
  });

  it("a webhook receives the notification as JSON", async () => {
    const { calls, impl } = recorder();
    await webhookChannel("https://example.com/hook", impl).deliver(notification);
    expect(bodyOf(calls[0]!.init)).toMatchObject({ kind: "approval_waiting", title: notification.title });
  });

  it("reports a refused delivery", async () => {
    const { impl } = recorder({ ok: false, status: 500 });
    await expect(webhookChannel("https://example.com/hook", impl).deliver(notification)).rejects.toThrow("500");
  });
});

describe("channelFor", () => {
  const config = (over: Partial<AppConfig>) =>
    ({ appUrl: "https://prospector.example", notifySlackWebhookUrl: null, notifyNtfyUrl: null, notifyWebhookUrl: null, ...over }) as AppConfig;

  it("prefers Slack, then ntfy, then a plain webhook", () => {
    expect(channelFor(config({ notifySlackWebhookUrl: HOOK, notifyNtfyUrl: "https://ntfy.sh/t" })).name).toBe("slack");
    expect(channelFor(config({ notifyNtfyUrl: "https://ntfy.sh/t", notifyWebhookUrl: "https://e.example" })).name).toBe("ntfy");
    expect(channelFor(config({ notifyWebhookUrl: "https://e.example" })).name).toBe("webhook");
  });

  it("falls back to holding notifications in the app when nothing is configured", () => {
    expect(channelFor(config({}))).toBe(inAppOnly);
  });
});

describe("telegramChannel", () => {
  it("sends the title, the body and a link to the chat", async () => {
    const { calls, impl } = recorder();
    await telegramChannel("123:abc", "987", "https://prospector.example", impl).deliver(notification);
    expect(calls[0]!.url).toBe("https://api.telegram.org/bot123:abc/sendMessage");
    const posted = bodyOf(calls[0]!.init);
    expect(posted.chat_id).toBe("987");
    expect(posted.text).toContain("3 drafts waiting");
    expect(posted.text).toContain("https://prospector.example/command");
  });

  it("escapes what MarkdownV2 reserves, which would otherwise fail the whole send", () => {
    expect(escapeMarkdown("Northbridge (pre-audit) — 40% up!")).toBe(
      "Northbridge \\(pre\\-audit\\) — 40% up\\!",
    );
  });

  it("keeps Telegram's own description when it refuses", async () => {
    const { impl } = recorder({ ok: false, status: 400, body: JSON.stringify({ description: "chat not found" }) });
    await expect(telegramChannel("123:abc", "987", "", impl).deliver(notification)).rejects.toThrow(
      "Telegram returned 400: chat not found",
    );
  });
});

describe("fanOut", () => {
  const ok = (name: string, log: string[]): DeliveryChannel => ({ name, deliver: async () => { log.push(name); } });
  const bad = (name: string): DeliveryChannel => ({ name, deliver: async () => { throw new Error("no"); } });

  it("delivers to every channel", async () => {
    const log: string[] = [];
    await fanOut([ok("slack", log), ok("telegram", log)]).deliver(notification);
    expect(log).toEqual(["slack", "telegram"]);
  });

  it("one failure does not stop the others", async () => {
    const log: string[] = [];
    await fanOut([bad("slack"), ok("telegram", log)]).deliver(notification);
    expect(log).toEqual(["telegram"]);
  });

  it("raises only when nothing got through at all", async () => {
    await expect(fanOut([bad("slack"), bad("telegram")]).deliver(notification)).rejects.toThrow("slack: no");
  });
});

describe("channelFromCredentials", () => {
  it("builds the channel the provider names", () => {
    expect(channelFromCredentials("slack", { webhookUrl: HOOK }, "").name).toBe("slack");
    expect(channelFromCredentials("telegram", { botToken: "1:a", chatId: "2" }, "").name).toBe("telegram");
    expect(channelFromCredentials("ntfy", { topicUrl: "https://ntfy.sh/t" }, "").name).toBe("ntfy");
    expect(channelFromCredentials("webhook", { url: "https://e.example" }, "").name).toBe("webhook");
  });
});
