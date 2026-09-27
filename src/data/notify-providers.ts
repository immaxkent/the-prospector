/**
 * The channels a notification can be delivered through, and what each needs to be connected.
 *
 * Telling an operator to set an environment variable is not a feature. Each provider here
 * describes what it asks for in plain terms, how to check the answer before it is stored, and
 * what to show afterwards — so connecting one is a form, and a wrong value is caught at the
 * moment it is typed rather than the night a run needs it.
 */

export const PROVIDERS = ["slack", "telegram", "ntfy", "webhook"] as const;
export type Provider = (typeof PROVIDERS)[number];

export interface ProviderField {
  key: string;
  label: string;
  placeholder: string;
  help: string;
  /** True when the value is a secret and must never be shown again once stored. */
  secret: boolean;
}

export interface ProviderInfo {
  id: Provider;
  name: string;
  /** What this gets you, in one line. */
  summary: string;
  /** The steps to follow before the form can be filled. */
  steps: string[];
  fields: ProviderField[];
}

export const PROVIDER_INFO: Record<Provider, ProviderInfo> = {
  slack: {
    id: "slack",
    name: "Slack",
    summary: "Posts into a Slack channel. Free on Slack's own plan and needs no app review.",
    steps: [
      "Go to api.slack.com/apps and create an app from scratch, in your workspace.",
      "Open Incoming Webhooks and turn it on.",
      "Add New Webhook to Workspace, and choose the channel notifications should land in.",
      "Copy the webhook URL and paste it below.",
    ],
    fields: [
      {
        key: "webhookUrl",
        label: "Webhook URL",
        placeholder: "https://hooks.slack.com/services/T000/B000/xxxx",
        help: "Anyone holding this can post to that channel, so it is stored encrypted and never shown again.",
        secret: true,
      },
    ],
  },

  telegram: {
    id: "telegram",
    name: "Telegram",
    summary: "Messages you directly. Free, and arrives on your phone without another app.",
    steps: [
      "Message @BotFather on Telegram and send /newbot, then follow the prompts.",
      "Copy the token it gives you.",
      "Send your new bot any message, so it is allowed to reply to you.",
      "Open api.telegram.org/bot<your token>/getUpdates and copy the chat id from the result.",
    ],
    fields: [
      { key: "botToken", label: "Bot token", placeholder: "123456:ABC-DEF…", help: "From BotFather.", secret: true },
      { key: "chatId", label: "Chat id", placeholder: "123456789", help: "The conversation to send to.", secret: false },
    ],
  },

  ntfy: {
    id: "ntfy",
    name: "ntfy",
    summary: "A phone push from a plain HTTP post. No account needed.",
    steps: [
      "Install ntfy on your phone and subscribe to a topic nobody else would guess.",
      "Paste the topic's URL below.",
    ],
    fields: [
      {
        key: "topicUrl",
        label: "Topic URL",
        placeholder: "https://ntfy.sh/your-private-topic",
        help: "Anyone who knows the topic can read it, so make it unguessable.",
        secret: true,
      },
    ],
  },

  webhook: {
    id: "webhook",
    name: "Webhook",
    summary: "Posts the notification as JSON to an endpoint of your own.",
    steps: ["Give the URL that should receive the post."],
    fields: [{ key: "url", label: "URL", placeholder: "https://example.com/hook", help: "", secret: true }],
  },
};

/** Slack refuses anything that is not its own webhook, so the mistake is caught here first. */
export const isSlackWebhook = (url: string) => /^https:\/\/hooks\.slack\.com\/services\/\S+$/.test(url.trim());

const isHttps = (url: string) => {
  try {
    return new URL(url.trim()).protocol === "https:";
  } catch {
    return false;
  }
};

/** A Telegram bot token is a numeric id, a colon, then the secret. */
export const isTelegramToken = (token: string) => /^\d{5,}:[A-Za-z0-9_-]{20,}$/.test(token.trim());

/**
 * Whether the values given can be stored, and why not when they cannot.
 * This checks shape only; whether the credential actually works is settled by a test send.
 */
export function checkCredentials(provider: Provider, values: Record<string, string>): string | null {
  const value = (key: string) => (values[key] ?? "").trim();

  if (provider === "slack") {
    if (!value("webhookUrl")) return "paste the webhook URL Slack gave you";
    if (!isSlackWebhook(value("webhookUrl"))) return "that is not a Slack webhook URL — it should start https://hooks.slack.com/services/";
    return null;
  }
  if (provider === "telegram") {
    if (!value("botToken")) return "paste the token BotFather gave you";
    if (!isTelegramToken(value("botToken"))) return "that does not look like a bot token — it should read like 123456:ABC-DEF…";
    if (!/^-?\d+$/.test(value("chatId"))) return "the chat id is a number, which getUpdates will show you";
    return null;
  }
  if (provider === "ntfy") {
    if (!value("topicUrl")) return "paste the topic URL";
    if (!isHttps(value("topicUrl"))) return "the topic URL must be https";
    return null;
  }
  if (!value("url")) return "give the URL to post to";
  if (!isHttps(value("url"))) return "the URL must be https";
  return null;
}

/** What to show about a connected channel, which must never include the secret itself. */
export function describeChannel(provider: Provider, values: Record<string, string>): string {
  if (provider === "telegram") return `chat ${values["chatId"] ?? "unknown"}`;
  const url = values["webhookUrl"] ?? values["topicUrl"] ?? values["url"] ?? "";
  try {
    return new URL(url).host;
  } catch {
    return "an address this server cannot parse";
  }
}
