/**
 * Creating a sending address on your own domain, from the app.
 *
 * Two calls to Google, in this order: the alias on the Workspace domain first, then the
 * send-as registration in Gmail. If the second fails the alias still exists and is recorded,
 * because an alias Google knows about but we have forgotten is worse than one we cannot yet
 * send from — the retry then finds it already there and says so.
 */
import { eq } from "drizzle-orm";
import type { Database } from "../db/client";
import { mailboxes } from "../db/schema";
import { sealJson, unsealJson } from "../crypto/tokens";
import { checkAliasRequest, type MailboxAlias } from "../domain/mailbox";
import { GmailClient, GmailError, type GmailContext } from "../mailboxes/gmail";
import { conflict, invalid, notFound } from "./errors";
import { hasAliasScopes, type GoogleTokenSet } from "./mailboxes";
import { recordEvent } from "./events";

export interface AliasDeps {
  clientId: string;
  clientSecret: string;
  tokenKey: Buffer;
  /** Replaced in tests; production talks to Google. */
  createClient?: (ctx: GmailContext) => GmailClient;
  fetchImpl?: GmailContext["fetchImpl"];
}

export interface CreateAliasInput {
  mailboxId: string;
  /** The whole address, on any domain the Workspace holds. */
  address: string;
  displayName: string;
}

export const ALIAS_CONSENT_NEEDED = "alias_consent_needed";

export async function createMailboxAlias(
  db: Database,
  deps: AliasDeps,
  input: CreateAliasInput,
  now = new Date(),
): Promise<{ alias: MailboxAlias; sendAsReady: boolean }> {
  const [mailbox] = await db.select().from(mailboxes).where(eq(mailboxes.id, input.mailboxId));
  if (!mailbox) throw notFound("mailbox");
  if (!mailbox.tokenCiphertext) throw conflict("reconnect this mailbox before adding an alias to it");

  const checked = checkAliasRequest(mailbox, input);
  if (!checked.ok) throw invalid(checked.reason);

  const tokens = unsealJson<GoogleTokenSet>(mailbox.tokenCiphertext, deps.tokenKey);
  if (!hasAliasScopes(tokens.scope)) throw conflict(ALIAS_CONSENT_NEEDED);

  const gmail = (deps.createClient ?? ((ctx) => new GmailClient(ctx)))({
    clientId: deps.clientId,
    clientSecret: deps.clientSecret,
    tokens,
    ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
  });

  try {
    await gmail.createDomainAlias(mailbox.address, checked.address);
  } catch (err) {
    // 409 means the address already exists on the domain: carry on and register the send-as.
    if (!(err instanceof GmailError) || err.status !== 409) throw err;
  }

  const alias: MailboxAlias = {
    address: checked.address,
    displayName: checked.displayName,
    createdAt: now.toISOString(),
  };

  let sendAsReady = false;
  let sendAsProblem: string | null = null;
  try {
    const sendAs = await gmail.createSendAs(checked.address, checked.displayName);
    sendAsReady = sendAs.verificationStatus === "accepted";
  } catch (err) {
    sendAsProblem = err instanceof Error ? err.message : String(err);
  }

  await db.transaction(async (tx) => {
    const [current] = await tx.select().from(mailboxes).where(eq(mailboxes.id, mailbox.id)).for("update");
    const existing = (current?.aliases ?? []).filter((a) => a.address.toLowerCase() !== alias.address);
    await tx
      .update(mailboxes)
      .set({
        aliases: [...existing, alias],
        // The client may have refreshed the access token while doing this work.
        ...(gmail.tokensChanged ? { tokenCiphertext: sealJson(gmail.currentTokens, deps.tokenKey) } : {}),
      })
      .where(eq(mailboxes.id, mailbox.id));
    await recordEvent(tx, {
      eventType: "mailbox.alias_created",
      entityType: "mailbox",
      entityId: mailbox.id,
      subject: alias.address,
      detail: sendAsReady ? "ready to send from" : (sendAsProblem ?? "created, but Gmail has not accepted it yet"),
      data: { sendAsReady },
    });
  }, { isolationLevel: "read committed" });

  return { alias, sendAsReady };
}

/** Sets or clears the address an endeavour sends under. Must be one the mailbox may send as. */
export async function setEndeavourFromAlias(
  db: Database,
  input: { endeavourId: string; alias: string | null },
) {
  const { endeavours } = await import("../db/schema");
  return db.transaction(async (tx) => {
    const [endeavour] = await tx.select().from(endeavours).where(eq(endeavours.id, input.endeavourId)).for("update");
    if (!endeavour) throw notFound("endeavour");

    const alias = input.alias?.trim().toLowerCase() || null;
    if (alias) {
      if (!endeavour.mailboxId) throw conflict("choose a mailbox for this endeavour first");
      const [mailbox] = await tx.select().from(mailboxes).where(eq(mailboxes.id, endeavour.mailboxId));
      if (!mailbox) throw notFound("mailbox");
      if (!mailbox.aliases.some((a) => a.address.toLowerCase() === alias)) {
        throw invalid(`${mailbox.address} cannot send as ${alias}`);
      }
    }
    await tx.update(endeavours).set({ fromAlias: alias }).where(eq(endeavours.id, endeavour.id));
    await recordEvent(tx, {
      eventType: "endeavour.from_alias_set",
      entityType: "endeavour",
      entityId: endeavour.id,
      endeavourId: endeavour.id,
      subject: endeavour.name,
      detail: alias ? `sends as ${alias}` : "sends as the mailbox's own address",
    });
    return { alias };
  }, { isolationLevel: "read committed" });
}
