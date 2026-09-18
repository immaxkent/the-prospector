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

/** No delivery: notifications wait in the app. The honest default until a channel is chosen. */
export const inAppOnly: DeliveryChannel = { name: "in_app", deliver: async () => {} };

export function channelFor(config: AppConfig, fetchImpl: Fetch = fetch): DeliveryChannel {
  if (config.notifyNtfyUrl) return ntfyChannel(config.notifyNtfyUrl, fetchImpl);
  if (config.notifyWebhookUrl) return webhookChannel(config.notifyWebhookUrl, fetchImpl);
  return inAppOnly;
}
