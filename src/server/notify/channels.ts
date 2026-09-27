/**
 * Delivery channels for notifications. Every notification is stored in the app regardless;
 * a channel is how it also reaches you elsewhere. Delivery failures never break a run.
 */
import type { AppConfig } from "../config";

export interface Notification {
  kind: string;
  title: string;
  body: string;
  endeavourId?: string | null;
  /** Where to look in the app, e.g. /command. */
  path?: string;
  priority?: "normal" | "high";
}

export interface DeliveryChannel {
  name: string;
  deliver: (notification: Notification) => Promise<void>;
}

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

/** Slack refuses a webhook URL that is not its own; anything else is a configuration mistake. */
export function isSlackWebhookUrl(url: string) {
  return /^https:\/\/hooks\.slack\.com\/services\//.test(url);
}

/**
 * Slack, through an incoming webhook (free on Slack's own free plan, no OAuth). Slack answers
 * a bad webhook with a plain-text reason such as "no_service", so the reason is kept: a
 * notification that silently never arrives is worse than one that says why.
 */
export function slackChannel(webhookUrl: string, appUrl = "", fetchImpl: Fetch = fetch): DeliveryChannel {
  return {
    name: "slack",
    deliver: async (notification) => {
      const link = notification.path && appUrl ? `${appUrl}${notification.path}` : null;
      const context = [
        notification.priority === "high" ? "Needs you" : null,
        notification.endeavourId ? `Endeavour ${notification.endeavourId}` : null,
        link ? `<${link}|Open in The Prospector>` : null,
      ].filter(Boolean);

      const res = await fetchImpl(webhookUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          // Shown in the notification preview and by clients that cannot render blocks.
          text: `${notification.title} — ${notification.body}`,
          blocks: [
            { type: "header", text: { type: "plain_text", text: notification.title.slice(0, 150), emoji: false } },
            { type: "section", text: { type: "mrkdwn", text: notification.body.slice(0, 2900) } },
            ...(context.length ? [{ type: "context", elements: [{ type: "mrkdwn", text: context.join("  ·  ") }] }] : []),
          ],
        }),
      });
      if (!res.ok) {
        const reason = await res.text().catch(() => "");
        throw new Error(`Slack returned ${res.status}${reason ? `: ${reason.trim().slice(0, 200)}` : ""}`);
      }
    },
  };
}

/** ntfy.sh (or a self-hosted instance): a phone push from a plain HTTP POST. */
export function ntfyChannel(topicUrl: string, fetchImpl: Fetch = fetch): DeliveryChannel {
  return {
    name: "ntfy",
    deliver: async (notification) => {
      const res = await fetchImpl(topicUrl, {
        method: "POST",
        headers: {
          title: notification.title,
          ...(notification.priority === "high" ? { priority: "high" } : {}),
          ...(notification.path ? { click: notification.path } : {}),
        },
        body: notification.body,
      });
      if (!res.ok) throw new Error(`ntfy returned ${res.status}`);
    },
  };
}

/** Anything that accepts a JSON POST: Pushover, Slack via a relay, your own endpoint. */
export function webhookChannel(url: string, fetchImpl: Fetch = fetch): DeliveryChannel {
  return {
    name: "webhook",
    deliver: async (notification) => {
      const res = await fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(notification),
      });
      if (!res.ok) throw new Error(`the webhook returned ${res.status}`);
    },
  };
}

/**
 * Telegram, through a bot you own. The chat id says who it talks to; the token proves it may.
 * Telegram answers a bad token with a description, which is kept for the same reason Slack's is.
 */
export function telegramChannel(botToken: string, chatId: string, appUrl = "", fetchImpl: Fetch = fetch): DeliveryChannel {
  return {
    name: "telegram",
    deliver: async (notification) => {
      const link = notification.path && appUrl ? `${appUrl}${notification.path}` : null;
      const lines = [
        `*${escapeMarkdown(notification.title)}*`,
        escapeMarkdown(notification.body),
        link ? `[Open in The Prospector](${link})` : null,
      ].filter(Boolean);

      const res = await fetchImpl(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: lines.join("\n\n"),
          parse_mode: "MarkdownV2",
          disable_web_page_preview: true,
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        let reason = body.trim().slice(0, 200);
        try {
          reason = (JSON.parse(body) as { description?: string }).description ?? reason;
        } catch {
          // Not JSON; the raw text is the best we have.
        }
        throw new Error(`Telegram returned ${res.status}${reason ? `: ${reason}` : ""}`);
      }
    },
  };
}

/** MarkdownV2 reserves a long list of characters, and an unescaped one fails the whole send. */
export function escapeMarkdown(text: string) {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, (c) => `\\${c}`);
}

/**
 * Every channel at once. One that fails does not stop the others, and the failures are
 * gathered rather than swallowed: a notification that reached two places out of three should
 * say so.
 */
export function fanOut(channels: readonly DeliveryChannel[]): DeliveryChannel {
  if (channels.length === 1) return channels[0]!;
  return {
    name: channels.map((c) => c.name).join("+") || "in_app",
    deliver: async (notification) => {
      const failures: string[] = [];
      for (const channel of channels) {
        try {
          await channel.deliver(notification);
        } catch (err) {
          failures.push(`${channel.name}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      if (failures.length === channels.length && channels.length > 0) throw new Error(failures.join("; "));
      if (failures.length) console.error(`some channels did not deliver — ${failures.join("; ")}`);
    },
  };
}

/** Builds a channel from a provider and the fields it was connected with. */
export function channelFromCredentials(
  provider: string,
  values: Record<string, string>,
  appUrl: string,
  fetchImpl: Fetch = fetch,
): DeliveryChannel {
  if (provider === "slack") return slackChannel(values["webhookUrl"] ?? "", appUrl, fetchImpl);
  if (provider === "telegram") return telegramChannel(values["botToken"] ?? "", values["chatId"] ?? "", appUrl, fetchImpl);
  if (provider === "ntfy") return ntfyChannel(values["topicUrl"] ?? "", fetchImpl);
  return webhookChannel(values["url"] ?? "", fetchImpl);
}

/** No delivery: notifications wait in the app. The honest default until a channel is chosen. */
export const inAppOnly: DeliveryChannel = { name: "in_app", deliver: async () => {} };

/** What Settings shows: the channel and the host, never the webhook's secret path. */
export function channelStatus(config: AppConfig): { channel: "slack" | "ntfy" | "webhook" | "in_app"; destination: string | null } {
  const url = config.notifySlackWebhookUrl ?? config.notifyNtfyUrl ?? config.notifyWebhookUrl;
  const channel = config.notifySlackWebhookUrl
    ? ("slack" as const)
    : config.notifyNtfyUrl
      ? ("ntfy" as const)
      : config.notifyWebhookUrl
        ? ("webhook" as const)
        : ("in_app" as const);
  let destination: string | null = null;
  if (url) {
    try {
      destination = new URL(url).host;
    } catch {
      destination = "an address this server cannot parse";
    }
  }
  return { channel, destination };
}

export function channelFor(config: AppConfig, fetchImpl: Fetch = fetch): DeliveryChannel {
  if (config.notifySlackWebhookUrl) return slackChannel(config.notifySlackWebhookUrl, config.appUrl, fetchImpl);
  if (config.notifyNtfyUrl) return ntfyChannel(config.notifyNtfyUrl, fetchImpl);
  if (config.notifyWebhookUrl) return webhookChannel(config.notifyWebhookUrl, fetchImpl);
  return inAppOnly;
}
