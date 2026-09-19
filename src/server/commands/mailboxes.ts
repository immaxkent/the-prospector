import { eq } from "drizzle-orm";
import type { Database } from "../db/client";
import { endeavours, mailboxes } from "../db/schema";
import { sealJson, unsealJson } from "../crypto/tokens";
import { DEFAULT_MAILBOX_LIMITS, mailboxLimitsSchema, type MailboxLimits } from "../domain/mailbox";
import { newId } from "../ids";
import { conflict, invalid, notFound } from "./errors";
import { recordEvent } from "./events";

export interface GoogleTokenSet {
  accessToken: string;
  refreshToken: string;
  /** Epoch milliseconds. */
  expiresAt: number;
  scope: string;
}

export const GMAIL_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.readonly",
] as const;

/**
 * Extra consent for creating an address: one scope to add the alias to the Workspace domain
 * (administrators only) and one to register it as a send-as address in Gmail. Kept apart from
 * the connect flow so someone who only wants to send never has to grant them.
 */
export const ALIAS_SCOPES = [
  "https://www.googleapis.com/auth/admin.directory.user.alias",
  "https://www.googleapis.com/auth/gmail.settings.sharing",
] as const;

const hasAll = (scope: string, required: readonly string[]) => {
  const granted = new Set(scope.split(" "));
  return required.filter((s) => s.startsWith("https://")).every((s) => granted.has(s));
};

export function hasGmailScopes(scope: string) {
  return hasAll(scope, GMAIL_SCOPES);
}

export function hasAliasScopes(scope: string) {
  return hasAll(scope, ALIAS_SCOPES);
}

/**
 * Connects or reconnects a Google mailbox. Tokens are sealed before they reach the database.
 * Google omits the refresh token when access was granted before; the stored one is kept then.
 */
export async function connectGoogleMailbox(
  db: Database,
  key: Buffer,
  input: {
    address: string;
    displayName: string;
    tokens: { accessToken: string; refreshToken?: string | undefined; expiresAt: number; scope: string };
  },
) {
  const address = input.address.trim().toLowerCase();
  if (!hasGmailScopes(input.tokens.scope)) throw invalid("Gmail send and read access were not granted");

  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(mailboxes).where(eq(mailboxes.address, address)).for("update");
    const previous = existing?.tokenCiphertext ? unsealJson<GoogleTokenSet>(existing.tokenCiphertext, key) : null;
    const refreshToken = input.tokens.refreshToken ?? previous?.refreshToken;
    if (!refreshToken) throw invalid("Google did not return offline access. Remove the app's access in your Google account and connect again.");

    const tokens: GoogleTokenSet = {
      accessToken: input.tokens.accessToken,
      refreshToken,
      expiresAt: input.tokens.expiresAt,
      scope: input.tokens.scope,
    };
    const tokenCiphertext = sealJson(tokens, key);

    if (existing) {
      await tx
        .update(mailboxes)
        .set({ status: "connected", tokenCiphertext, displayName: input.displayName || existing.displayName })
        .where(eq(mailboxes.id, existing.id));
    } else {
      await tx.insert(mailboxes).values({
        id: newId("mailbox"),
        address,
        displayName: input.displayName || address,
        provider: "google",
        status: "connected",
        limits: DEFAULT_MAILBOX_LIMITS,
        tokenCiphertext,
      });
    }
    const [row] = await tx.select().from(mailboxes).where(eq(mailboxes.address, address));
    await recordEvent(tx, {
      eventType: existing ? "mailbox.reconnected" : "mailbox.connected",
      entityType: "mailbox",
      entityId: row!.id,
      subject: address,
    });
    return { id: row!.id, address, reconnected: !!existing };
  });
}

export async function updateMailboxLimits(db: Database, input: { mailboxId: string; limits: MailboxLimits }) {
  const parsed = mailboxLimitsSchema.safeParse(input.limits);
  if (!parsed.success) throw invalid("mailbox limits are invalid");
  const limits = parsed.data;
  if (limits.weeklyCap < limits.dailyCap) throw invalid("the weekly cap cannot be lower than the daily cap");
  if (limits.warmup && limits.warmup.startCap > limits.dailyCap)
    throw invalid("warm-up cannot start above the daily cap");
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: limits.timezone });
  } catch {
    throw invalid(`unknown timezone ${limits.timezone}`);
  }
  const [row] = await db.update(mailboxes).set({ limits }).where(eq(mailboxes.id, input.mailboxId)).returning({ id: mailboxes.id });
  if (!row) throw notFound("mailbox");
}

/** Removes stored tokens. Endeavours keep their assignment but cannot send until it is reconnected or changed. */
export async function disconnectMailbox(db: Database, input: { mailboxId: string }) {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(mailboxes)
      .set({ status: "disconnected", tokenCiphertext: null })
      .where(eq(mailboxes.id, input.mailboxId))
      .returning({ id: mailboxes.id, address: mailboxes.address });
    if (!row) throw notFound("mailbox");
    await recordEvent(tx, { eventType: "mailbox.disconnected", entityType: "mailbox", entityId: row.id, subject: row.address });
  });
}

/** Chooses the mailbox an endeavour sends through, keeping the stored spec in step. */
export async function assignEndeavourMailbox(db: Database, input: { endeavourId: string; mailboxId: string }) {
  return db.transaction(async (tx) => {
    const [mailbox] = await tx.select().from(mailboxes).where(eq(mailboxes.id, input.mailboxId));
    if (!mailbox) throw notFound("mailbox");
    if (mailbox.status !== "connected") throw conflict(`${mailbox.address} is not connected`);
    const [e] = await tx.select().from(endeavours).where(eq(endeavours.id, input.endeavourId)).for("update");
    if (!e) throw notFound("endeavour");
    if (e.status === "archived") throw conflict("an archived endeavour cannot change mailbox");
    await tx
      .update(endeavours)
      .set({ mailboxId: mailbox.id, spec: { ...e.spec, mailboxId: { state: "confirmed", value: mailbox.id } } })
      .where(eq(endeavours.id, e.id));
    await recordEvent(tx, {
      eventType: "endeavour.mailbox_changed",
      entityType: "endeavour",
      entityId: e.id,
      endeavourId: e.id,
      subject: e.name,
      detail: mailbox.address,
    });
  });
}
