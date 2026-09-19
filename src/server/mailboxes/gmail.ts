/**
 * Gmail API access for one mailbox. Access tokens are refreshed when they expire and the
 * refreshed set is handed back to the caller to re-seal; nothing is cached in the clear.
 */
import { z } from "zod/v4";
import type { GoogleTokenSet } from "../commands/mailboxes";
import { GOOGLE_TOKEN_URL, type Fetch } from "../auth/google-oauth";

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";
const DIRECTORY_API = "https://admin.googleapis.com/admin/directory/v1";
/** Refresh a little early so a long request cannot start with an expiring token. */
const REFRESH_MARGIN_MS = 60_000;

export class GmailError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

const refreshSchema = z.object({ access_token: z.string().min(1), expires_in: z.number() });

const sendSchema = z.object({ id: z.string().min(1), threadId: z.string().min(1) });

const aliasSchema = z.object({ alias: z.string().min(3) });

const sendAsSchema = z.object({
  sendAsEmail: z.string().min(3),
  displayName: z.string().default(""),
  isDefault: z.boolean().default(false),
  /** "accepted" once Google is happy to send from it; an alias of the same account is immediate. */
  verificationStatus: z.string().default("accepted"),
});

const sendAsListSchema = z.object({ sendAs: z.array(sendAsSchema).default([]) });

const listSchema = z.object({
  messages: z.array(z.object({ id: z.string(), threadId: z.string() })).default([]),
  nextPageToken: z.string().optional(),
});

const headerSchema = z.object({ name: z.string(), value: z.string() });

const messageSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  labelIds: z.array(z.string()).default([]),
  internalDate: z.string().optional(),
  payload: z
    .object({
      headers: z.array(headerSchema).default([]),
      mimeType: z.string().optional(),
      body: z.object({ data: z.string().optional() }).optional(),
      parts: z
        .array(
          z.object({
            mimeType: z.string().optional(),
            body: z.object({ data: z.string().optional() }).optional(),
          }),
        )
        .optional(),
    })
    .optional(),
});

export type GmailMessage = z.infer<typeof messageSchema>;

export interface GmailContext {
  clientId: string;
  clientSecret: string;
  tokens: GoogleTokenSet;
  fetchImpl?: Fetch;
  now?: () => number;
}

export interface SentMessage {
  externalMessageId: string;
  externalThreadId: string;
}

/** Plain text of a message, from the body or the first text/plain part. */
export function plainTextOf(message: GmailMessage) {
  const decode = (data?: string) => (data ? Buffer.from(data, "base64url").toString("utf8") : "");
  const payload = message.payload;
  if (!payload) return "";
  if (payload.body?.data) return decode(payload.body.data);
  const part = payload.parts?.find((p) => p.mimeType === "text/plain") ?? payload.parts?.[0];
  return decode(part?.body?.data);
}

/** Google's errors carry a human sentence; it is far more use than the status alone. */
export function googleErrorMessage(body: string) {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } | string };
    const error = parsed.error;
    const message = typeof error === "string" ? error : error?.message;
    if (message) return message.slice(0, 200);
  } catch {
    // Not JSON: fall through to the raw text.
  }
  return body.trim().slice(0, 200);
}

export function headerOf(message: GmailMessage, name: string) {
  return message.payload?.headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? null;
}

export class GmailClient {
  private tokens: GoogleTokenSet;
  private refreshed = false;

  constructor(private readonly ctx: GmailContext) {
    this.tokens = ctx.tokens;
  }

  /** The current token set, so the caller can store it when it changed. */
  get currentTokens(): GoogleTokenSet {
    return this.tokens;
  }

  get tokensChanged() {
    return this.refreshed;
  }

  private get fetchImpl(): Fetch {
    return this.ctx.fetchImpl ?? fetch;
  }

  private now() {
    return this.ctx.now?.() ?? Date.now();
  }

  private async accessToken() {
    if (this.tokens.expiresAt - REFRESH_MARGIN_MS > this.now()) return this.tokens.accessToken;
    const res = await this.fetchImpl(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.ctx.clientId,
        client_secret: this.ctx.clientSecret,
        refresh_token: this.tokens.refreshToken,
        grant_type: "refresh_token",
      }).toString(),
    });
    if (!res.ok) {
      // A refused refresh means the mailbox must be reconnected; retrying will not help.
      throw new GmailError(`could not refresh the mailbox token (${res.status})`, res.status, false);
    }
    const parsed = refreshSchema.safeParse(await res.json());
    if (!parsed.success) throw new GmailError("the token refresh response was malformed", 500, false);
    this.tokens = { ...this.tokens, accessToken: parsed.data.access_token, expiresAt: this.now() + parsed.data.expires_in * 1000 };
    this.refreshed = true;
    return this.tokens.accessToken;
  }

  /** Any Google endpoint, with the token attached and Google's own reason kept on failure. */
  private async callUrl(url: string, init: RequestInit = {}, what = "Google request") {
    const token = await this.accessToken();
    const res = await this.fetchImpl(url, {
      ...init,
      headers: { ...(init.headers ?? {}), authorization: `Bearer ${token}`, "content-type": "application/json" },
    });
    if (!res.ok) {
      const retryable = res.status === 429 || res.status >= 500;
      const reason = await res.text().catch(() => "");
      const detail = googleErrorMessage(reason);
      throw new GmailError(`${what} failed (${res.status})${detail ? `: ${detail}` : ""}`, res.status, retryable);
    }
    return res.json();
  }

  private call(path: string, init: RequestInit = {}) {
    return this.callUrl(`${GMAIL_API}${path}`, init, `Gmail request for ${path}`);
  }

  async send(raw: string, threadId?: string | null): Promise<SentMessage> {
    const body = JSON.stringify({ raw, ...(threadId ? { threadId } : {}) });
    const parsed = sendSchema.safeParse(await this.call("/messages/send", { method: "POST", body }));
    if (!parsed.success) throw new GmailError("the send response was malformed", 500, false);
    return { externalMessageId: parsed.data.id, externalThreadId: parsed.data.threadId };
  }

  /** Message ids matching a Gmail search, newest first. */
  async list(query: string, maxResults = 25) {
    const params = new URLSearchParams({ q: query, maxResults: String(maxResults) });
    const parsed = listSchema.safeParse(await this.call(`/messages?${params}`));
    if (!parsed.success) throw new GmailError("the message list response was malformed", 500, false);
    return parsed.data.messages;
  }

  /**
   * Adds an alias to the Workspace account that owns this mailbox. Needs the Admin SDK and an
   * administrator's consent: Google answers 403 for anyone else, and that reason is passed on.
   */
  async createDomainAlias(userKey: string, alias: string) {
    const parsed = aliasSchema.safeParse(
      await this.callUrl(`${DIRECTORY_API}/users/${encodeURIComponent(userKey)}/aliases`, {
        method: "POST",
        body: JSON.stringify({ alias }),
      }, "creating the domain alias"),
    );
    if (!parsed.success) throw new GmailError("the alias response was malformed", 500, false);
    return parsed.data.alias;
  }

  /** Registers an address this account may send as. An alias of the same account needs no verification. */
  async createSendAs(sendAsEmail: string, displayName: string) {
    const parsed = sendAsSchema.safeParse(
      await this.callUrl(`${GMAIL_API}/settings/sendAs`, {
        method: "POST",
        body: JSON.stringify({ sendAsEmail, displayName, treatAsAlias: true }),
      }, "registering the send-as address"),
    );
    if (!parsed.success) throw new GmailError("the send-as response was malformed", 500, false);
    return parsed.data;
  }

  /** Every address this account may already send as, including its own. */
  async listSendAs() {
    const parsed = sendAsListSchema.safeParse(await this.call("/settings/sendAs"));
    if (!parsed.success) throw new GmailError("the send-as list was malformed", 500, false);
    return parsed.data.sendAs;
  }

  async get(id: string): Promise<GmailMessage> {
    const parsed = messageSchema.safeParse(await this.call(`/messages/${encodeURIComponent(id)}?format=full`));
    if (!parsed.success) throw new GmailError(`message ${id} was malformed`, 500, false);
    return parsed.data;
  }
}
