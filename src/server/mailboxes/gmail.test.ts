import { describe, expect, it, vi } from "vitest";
import type { Fetch } from "../auth/google-oauth";
import { GmailClient, GmailError, headerOf, plainTextOf, type GmailMessage } from "./gmail";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const NOW = 1_000_000;
const tokens = { accessToken: "at", refreshToken: "rt", expiresAt: NOW + 600_000, scope: "gmail" };

function client(handler: Fetch, over: Partial<typeof tokens> = {}) {
  return new GmailClient({ clientId: "cid", clientSecret: "sec", tokens: { ...tokens, ...over }, fetchImpl: handler, now: () => NOW });
}

describe("token refresh", () => {
  it("uses the stored token while it is valid", async () => {
    const fetchImpl = vi.fn<Fetch>(async () => json({ id: "m1", threadId: "t1" }));
    const gmail = client(fetchImpl);
    await gmail.send("raw");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(gmail.tokensChanged).toBe(false);
  });

  it("refreshes an expiring token and reports the new set", async () => {
    const calls: string[] = [];
    const fetchImpl: Fetch = async (url) => {
      calls.push(url);
      return url.includes("oauth2") ? json({ access_token: "fresh", expires_in: 3600 }) : json({ id: "m1", threadId: "t1" });
    };
    const gmail = client(fetchImpl, { expiresAt: NOW + 1000 });
    await gmail.send("raw");
    expect(calls[0]).toContain("oauth2");
    expect(gmail.tokensChanged).toBe(true);
    expect(gmail.currentTokens).toMatchObject({ accessToken: "fresh", refreshToken: "rt", expiresAt: NOW + 3_600_000 });
  });

  it("treats a refused refresh as permanent: the mailbox must be reconnected", async () => {
    const gmail = client(async () => json({ error: "invalid_grant" }, 400), { expiresAt: 0 });
    await expect(gmail.send("raw")).rejects.toMatchObject({ retryable: false });
  });
});

describe("send", () => {
  it("posts the raw message and returns Gmail's ids", async () => {
    const fetchImpl = vi.fn<Fetch>(async () => json({ id: "m1", threadId: "t1" }));
    const result = await client(fetchImpl).send("cmF3", "t1");
    expect(result).toEqual({ externalMessageId: "m1", externalThreadId: "t1" });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toContain("/messages/send");
    expect(JSON.parse(init!.body as string)).toEqual({ raw: "cmF3", threadId: "t1" });
    expect((init!.headers as Record<string, string>)["authorization"]).toBe("Bearer at");
  });

  it("marks rate limits and server errors as worth retrying, but not a rejection", async () => {
    await expect(client(async () => json({}, 429)).send("raw")).rejects.toMatchObject({ retryable: true });
    await expect(client(async () => json({}, 503)).send("raw")).rejects.toMatchObject({ retryable: true });
    await expect(client(async () => json({}, 400)).send("raw")).rejects.toMatchObject({ retryable: false });
    await expect(client(async () => json({ id: 1 })).send("raw")).rejects.toBeInstanceOf(GmailError);
  });
});

describe("reading", () => {
  it("lists ids for a search", async () => {
    const fetchImpl = vi.fn<Fetch>(async () => json({ messages: [{ id: "m1", threadId: "t1" }] }));
    const result = await client(fetchImpl).list("newer_than:2d -from:me", 10);
    expect(result).toEqual([{ id: "m1", threadId: "t1" }]);
    expect(fetchImpl.mock.calls[0]![0]).toContain("q=newer_than%3A2d+-from%3Ame");
  });

  it("reads plain text from a simple body or a multipart message", () => {
    const encode = (text: string) => Buffer.from(text, "utf8").toString("base64url");
    const simple = { id: "m", threadId: "t", labelIds: [], payload: { headers: [], body: { data: encode("hello") } } } as GmailMessage;
    expect(plainTextOf(simple)).toBe("hello");

    const multipart = {
      id: "m",
      threadId: "t",
      labelIds: [],
      payload: {
        headers: [{ name: "Subject", value: "Re: Bridge" }],
        parts: [
          { mimeType: "text/html", body: { data: encode("<p>html</p>") } },
          { mimeType: "text/plain", body: { data: encode("plain reply") } },
        ],
      },
    } as GmailMessage;
    expect(plainTextOf(multipart)).toBe("plain reply");
    expect(headerOf(multipart, "subject")).toBe("Re: Bridge");
    expect(headerOf(multipart, "from")).toBeNull();
  });
});
