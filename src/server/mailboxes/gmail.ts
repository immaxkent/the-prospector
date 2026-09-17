/**
 * Gmail API access for one mailbox. Access tokens are refreshed when they expire and the
 * refreshed set is handed back to the caller to re-seal; nothing is cached in the clear.
 */
import { z } from "zod/v4";
import type { GoogleTokenSet } from "../commands/mailboxes";
import { GOOGLE_TOKEN_URL, type Fetch } from "../auth/google-oauth";

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";
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

  private async call(path: string, init: RequestInit = {}) {
    const token = await this.accessToken();
    const res = await this.fetchImpl(`${GMAIL_API}${path}`, {
      ...init,
      headers: { ...(init.headers ?? {}), authorization: `Bearer ${token}`, "content-type": "application/json" },
    });
    if (!res.ok) {
      const retryable = res.status === 429 || res.status >= 500;
      throw new GmailError(`Gmail request failed (${res.status}) for ${path}`, res.status, retryable);
    }
    return res.json();
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

  async get(id: string): Promise<GmailMessage> {
    const parsed = messageSchema.safeParse(await this.call(`/messages/${encodeURIComponent(id)}?format=full`));
    if (!parsed.success) throw new GmailError(`message ${id} was malformed`, 500, false);
    return parsed.data;
  }
}
