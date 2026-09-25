import { describe, expect, it } from "vitest";
import { PROVIDERS, PROVIDER_INFO, checkCredentials, describeChannel, isSlackWebhook, isTelegramToken } from "./notify-providers";

describe("every provider explains itself", () => {
  it("has a name, a summary, steps and at least one field", () => {
    for (const id of PROVIDERS) {
      const info = PROVIDER_INFO[id];
      expect(info.name.length).toBeGreaterThan(0);
      expect(info.summary.length).toBeGreaterThan(0);
      expect(info.steps.length).toBeGreaterThan(0);
      expect(info.fields.length).toBeGreaterThan(0);
    }
  });

  it("marks the credential itself as secret, so it is never shown again", () => {
    expect(PROVIDER_INFO.slack.fields[0]!.secret).toBe(true);
    expect(PROVIDER_INFO.telegram.fields.find((f) => f.key === "botToken")?.secret).toBe(true);
    // A chat id is not a secret and showing it helps the operator recognise the channel.
    expect(PROVIDER_INFO.telegram.fields.find((f) => f.key === "chatId")?.secret).toBe(false);
  });
});

describe("checkCredentials", () => {
  it("accepts a real Slack webhook and rejects anything else", () => {
    expect(checkCredentials("slack", { webhookUrl: "https://hooks.slack.com/services/T0/B0/xyz" })).toBeNull();
    expect(checkCredentials("slack", { webhookUrl: "" })).toContain("paste the webhook URL");
    expect(checkCredentials("slack", { webhookUrl: "https://example.com/hook" })).toContain("not a Slack webhook");
    // A lookalike host must not pass.
    expect(isSlackWebhook("https://hooks.slack.com.evil.example/services/x")).toBe(false);
  });

  it("accepts a Telegram token and chat id, and explains what is wrong when it does not", () => {
    expect(checkCredentials("telegram", { botToken: "123456:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw", chatId: "987654" })).toBeNull();
    expect(checkCredentials("telegram", { botToken: "nonsense", chatId: "1" })).toContain("bot token");
    expect(checkCredentials("telegram", { botToken: "123456:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw", chatId: "abc" })).toContain("chat id");
    // Group chats have negative ids, which are still valid.
    expect(checkCredentials("telegram", { botToken: "123456:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw", chatId: "-100123" })).toBeNull();
  });

  it("insists the other providers are reachable over https", () => {
    expect(checkCredentials("ntfy", { topicUrl: "https://ntfy.sh/abc" })).toBeNull();
    expect(checkCredentials("ntfy", { topicUrl: "http://ntfy.sh/abc" })).toContain("https");
    expect(checkCredentials("webhook", { url: "https://example.com/hook" })).toBeNull();
    expect(checkCredentials("webhook", { url: "not a url" })).toContain("https");
  });

  it("recognises a bot token by shape, not by hope", () => {
    expect(isTelegramToken("123456:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw")).toBe(true);
    expect(isTelegramToken("123456")).toBe(false);
    expect(isTelegramToken(":AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw")).toBe(false);
  });
});

describe("describeChannel", () => {
  it("shows the host, never the secret", () => {
    const described = describeChannel("slack", { webhookUrl: "https://hooks.slack.com/services/T0/B0/supersecret" });
    expect(described).toBe("hooks.slack.com");
    expect(described).not.toContain("supersecret");
  });

  it("shows which conversation a Telegram channel talks to", () => {
    expect(describeChannel("telegram", { chatId: "987654", botToken: "x" })).toBe("chat 987654");
  });
});
