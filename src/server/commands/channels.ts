/**
 * Connecting, testing and disconnecting notification channels.
 *
 * Nothing is stored until it has actually delivered something: a credential that has never
 * worked is worse than none, because it looks connected. The test send happens first, and a
 * refusal comes back in the provider's own words.
 */
import { desc, eq } from "drizzle-orm";
import type { Database } from "../db/client";
import { notificationChannels } from "../db/schema";
import { sealJson, unsealJson } from "../crypto/tokens";
import { channelFromCredentials, inAppOnly, type DeliveryChannel, type Fetch } from "../notify/channels";
import { checkCredentials, describeChannel, PROVIDERS, type Provider } from "@/data/notify-providers";
import { newId } from "../ids";
import { invalid, notFound } from "./errors";
import { recordEvent } from "./events";

export interface ChannelDeps {
  tokenKey: Buffer;
  appUrl: string;
  fetchImpl?: Fetch;
}

export interface ConnectChannelInput {
  provider: string;
  values: Record<string, string>;
}

const isProvider = (value: string): value is Provider => (PROVIDERS as readonly string[]).includes(value);

/** What the operator may see: never the credential, only what it points at. */
export interface ChannelSummary {
  id: string;
  provider: Provider;
  label: string;
  enabled: boolean;
  lastDeliveredAt: string | null;
  lastError: string | null;
}

export async function listChannels(db: Database): Promise<ChannelSummary[]> {
  const rows = await db.select().from(notificationChannels).orderBy(notificationChannels.createdAt);
  return rows.map((row) => ({
    id: row.id,
    provider: row.provider,
    label: row.label,
    enabled: row.enabled,
    lastDeliveredAt: row.lastDeliveredAt?.toISOString() ?? null,
    lastError: row.lastError,
  }));
}

export async function connectChannel(db: Database, deps: ChannelDeps, input: ConnectChannelInput, now = new Date()) {
  if (!isProvider(input.provider)) throw invalid("that is not a channel this app can send through");
  const problem = checkCredentials(input.provider, input.values);
  if (problem) throw invalid(problem);

  const trimmed = Object.fromEntries(Object.entries(input.values).map(([k, v]) => [k, v.trim()]));
  const channel = channelFromCredentials(input.provider, trimmed, deps.appUrl, deps.fetchImpl);

  // Prove it works before storing it. A credential that has never delivered is worse than
  // none at all, because the screen says connected and the notifications go nowhere.
  await channel.deliver({
    kind: "test",
    title: "The Prospector can reach you",
    body: "This channel is connected. Nothing needs your attention.",
    path: "/command",
  });

  const label = describeChannel(input.provider, trimmed);
  const id = newId("notificationChannel");
  // Bound out here: the narrowing from isProvider above does not survive into the closure.
  const provider = input.provider;

  return db.transaction(async (tx) => {
    /*
     * One endpoint, not a fan-out.
     *
     * A daily digest arriving in two places is read in neither: the second copy is noise,
     * and the operator learns to ignore both. Connecting a channel elects it and retires
     * whatever was there — stored rather than deleted, so a mistaken switch is one
     * reconnection away rather than a credential to go and find again.
     */
    const superseded = await tx
      .update(notificationChannels)
      .set({ enabled: false })
      .where(eq(notificationChannels.enabled, true))
      .returning({ provider: notificationChannels.provider, label: notificationChannels.label });

    await tx.insert(notificationChannels).values({
      id,
      provider,
      label,
      secretCiphertext: sealJson(trimmed, deps.tokenKey),
      lastDeliveredAt: now,
    });
    await recordEvent(tx, {
      eventType: "notification_channel.connected",
      entityType: "notification_channel",
      entityId: id,
      subject: `${provider} · ${label}`,
      detail: superseded.length
        ? `now the only endpoint; ${superseded.map((c) => c.provider).join(", ")} stopped receiving`
        : "now the only endpoint",
    });
    return { id, provider, label, superseded: superseded.map((c) => c.provider) };
  }, { isolationLevel: "read committed" });
}

export async function disconnectChannel(db: Database, input: { channelId: string }) {
  const [row] = await db
    .delete(notificationChannels)
    .where(eq(notificationChannels.id, input.channelId))
    .returning({ id: notificationChannels.id, provider: notificationChannels.provider, label: notificationChannels.label });
  if (!row) throw notFound("notification channel");
  await recordEvent(db, {
    eventType: "notification_channel.disconnected",
    entityType: "notification_channel",
    entityId: row.id,
    subject: `${row.provider} · ${row.label}`,
  });
}

/** Sends a test through one stored channel, recording whether it arrived. */
export async function testChannel(db: Database, deps: ChannelDeps, input: { channelId: string }, now = new Date()) {
  const [row] = await db.select().from(notificationChannels).where(eq(notificationChannels.id, input.channelId));
  if (!row) throw notFound("notification channel");
  const values = unsealJson<Record<string, string>>(row.secretCiphertext, deps.tokenKey);
  const channel = channelFromCredentials(row.provider, values, deps.appUrl, deps.fetchImpl);
  try {
    await channel.deliver({
      kind: "test",
      title: "The Prospector can reach you",
      body: `Test sent at ${now.toISOString().replace("T", " ").slice(0, 16)} UTC.`,
      path: "/command",
    });
    await db.update(notificationChannels).set({ lastDeliveredAt: now, lastError: null }).where(eq(notificationChannels.id, row.id));
    return { delivered: true as const };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.update(notificationChannels).set({ lastError: message.slice(0, 500) }).where(eq(notificationChannels.id, row.id));
    throw invalid(message);
  }
}

/**
 * Everywhere notifications should go. Connected channels first; the environment variables
 * remain a fallback so a box configured the old way keeps working.
 */
/**
 * The one endpoint notifications go to.
 *
 * Newest first, and only one: connecting a channel retires the others, so there should
 * never be two. If there somehow are — a half-applied migration, a hand-edited row — the
 * most recent is the one the operator last chose, which is a better guess than both.
 */
export async function deliveryChannel(db: Database, deps: ChannelDeps & { fromEnv?: DeliveryChannel }): Promise<DeliveryChannel> {
  const [row] = await db
    .select()
    .from(notificationChannels)
    .where(eq(notificationChannels.enabled, true))
    .orderBy(desc(notificationChannels.createdAt));
  if (!row) return deps.fromEnv ?? inAppOnly;
  return channelFromCredentials(
    row.provider,
    unsealJson<Record<string, string>>(row.secretCiphertext, deps.tokenKey),
    deps.appUrl,
    deps.fetchImpl,
  );
}
