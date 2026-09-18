/**
 * Proving the notification channel works. A test is delivered but not stored: it is a
 * connectivity check, not news, and it must be repeatable without tripping the dedupe window.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSession } from "./session";

export const sendTestNotificationFn = createServerFn({ method: "POST" })
  .middleware([requireSession])
  .handler(async () => {
    const [{ getConfig }, channels] = await Promise.all([
      import("../server/config"),
      import("../server/notify/channels"),
    ]);
    const config = getConfig();
    const status = channels.channelStatus(config);
    if (status.channel === "in_app") {
      throw new Error(
        "No channel is configured, so notifications only wait in the app. Set NOTIFY_SLACK_WEBHOOK_URL on the server.",
      );
    }

    const channel = channels.channelFor(config);
    await channel.deliver({
      kind: "test",
      title: "The Prospector can reach you",
      body: `Test notification sent at ${new Date().toISOString().replace("T", " ").slice(0, 16)} UTC. Nothing needs your attention.`,
      path: "/command",
    });
    return { channel: status.channel, destination: status.destination };
  });
