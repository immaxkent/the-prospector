/**
 * Notifications. Everything is recorded in the app first, then delivered if a channel is
 * configured. A delivery failure is written down and swallowed: a push that does not arrive
 * must never stop the daily run.
 */
import { and, desc, eq, gte, isNull } from "drizzle-orm";
import type { Database } from "../db/client";
import { notifications } from "../db/schema";
import { newId } from "../ids";
import type { DeliveryChannel, Notification } from "../notify/channels";
import { notFound } from "./errors";

export interface NotifyResult {
  id: string;
  delivered: boolean;
  error: string | null;
}

/** How long the same notification is considered a repeat rather than news. */
export const DEDUPE_WINDOW_MS = 6 * 60 * 60 * 1000;

export async function notify(
  db: Database,
  channel: DeliveryChannel,
  notification: Notification,
  now = new Date(),
): Promise<NotifyResult | null> {
  // The same message about the same thing within the window is not worth repeating.
  const [recent] = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(
      and(
        eq(notifications.kind, notification.kind),
        eq(notifications.title, notification.title),
        gte(notifications.createdAt, new Date(now.getTime() - DEDUPE_WINDOW_MS)),
      ),
    )
    .limit(1);
  if (recent) return null;

  const id = newId("notification");
  await db.insert(notifications).values({
    id,
    endeavourId: notification.endeavourId ?? null,
    kind: notification.kind,
    title: notification.title,
    body: notification.body,
  });

  try {
    await channel.deliver(notification);
    await db.update(notifications).set({ deliveredAt: now }).where(eq(notifications.id, id));
    return { id, delivered: true, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`notification ${id} could not be delivered via ${channel.name}: ${message}`);
    return { id, delivered: false, error: message };
  }
}

export async function unreadNotifications(db: Database, limit = 20) {
  return db
    .select()
    .from(notifications)
    .where(isNull(notifications.readAt))
    .orderBy(desc(notifications.createdAt))
    .limit(limit);
}

export async function markNotificationRead(db: Database, input: { id: string }, now = new Date()) {
  const [row] = await db
    .update(notifications)
    .set({ readAt: now })
    .where(eq(notifications.id, input.id))
    .returning({ id: notifications.id });
  if (!row) throw notFound("notification");
}

export async function markAllNotificationsRead(db: Database, now = new Date()) {
  const rows = await db
    .update(notifications)
    .set({ readAt: now })
    .where(isNull(notifications.readAt))
    .returning({ id: notifications.id });
  return { marked: rows.length };
}
