import { randomBytes } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { parseCookies } from "../../src/server/auth/http";
import { createSession, SESSION_COOKIE, upsertUser } from "../../src/server/auth/sessions";
import { GMAIL_SCOPES } from "../../src/server/commands/mailboxes";
import { loadConfig } from "../../src/server/config";
import * as t from "../../src/server/db/schema";
import {
  MAILBOX_OAUTH_COOKIE,
  handleMailboxConnectCallback,
  handleMailboxConnectStart,
} from "../../src/server/mailboxes/connect-http";
import { testDb, truncateAll } from "./helpers";

const handle = testDb();
afterAll(() => handle.close());
beforeEach(() => truncateAll(handle));

const config = loadConfig({
  DATABASE_URL: process.env["DATABASE_URL"],
  APP_URL: "http://localhost:4000",
  GOOGLE_CLIENT_ID: "cid",
  GOOGLE_CLIENT_SECRET: "sec",
  AUTH_ALLOWED_EMAILS: "max@example.com",
  TOKEN_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
});

function google(scope = GMAIL_SCOPES.join(" "), refresh: string | null = "rt"): (url: string) => Promise<Response> {
  return async (url) =>
    new Response(
      JSON.stringify(
        url.includes("/token")
          ? { access_token: "at", expires_in: 3600, scope, token_type: "Bearer", ...(refresh ? { refresh_token: refresh } : {}) }
          : { sub: "g2", email: "Max@Decastream.example", email_verified: true, name: "Max" },
      ),
    );
}

async function sessionCookie() {
  const user = await upsertUser(handle.db, { email: "max@example.com" });
  const { token } = await createSession(handle.db, user.id);
  return `${SESSION_COOKIE}=${token}`;
}

async function start(cookie: string) {
  const res = await handleMailboxConnectStart(new Request("http://localhost:4000/mailboxes/google/connect", { headers: { cookie } }), {
    config,
    db: handle.db,
  });
  const location = new URL(res.headers.get("location")!);
  const pending = parseCookies(res.headers.getSetCookie()[0]!.split(";")[0]!)[MAILBOX_OAUTH_COOKIE]!;
  return { location, pending };
}

describe("mailbox connect over HTTP", () => {
  it("requires sign-in", async () => {
    const res = await handleMailboxConnectStart(new Request("http://localhost:4000/mailboxes/google/connect"), { config, db: handle.db });
    expect(res.headers.get("location")).toBe("/login?returnTo=%2Fsettings");
  });

  it("asks Google for Gmail scopes with offline consent", async () => {
    const { location } = await start(await sessionCookie());
    expect(location.searchParams.get("redirect_uri")).toBe("http://localhost:4000/mailboxes/google/callback");
    expect(location.searchParams.get("scope")).toContain("gmail.send");
    expect(location.searchParams.get("access_type")).toBe("offline");
    expect(location.searchParams.get("prompt")).toBe("consent");
  });

  it("connects the mailbox and returns to settings", async () => {
    const cookie = await sessionCookie();
    const { location, pending } = await start(cookie);
    const res = await handleMailboxConnectCallback(
      new Request(`http://localhost:4000/mailboxes/google/callback?code=c&state=${location.searchParams.get("state")}`, {
        headers: { cookie: `${cookie}; ${MAILBOX_OAUTH_COOKIE}=${pending}` },
      }),
      { config, db: handle.db, fetchImpl: google(), now: () => 1_000_000 },
    );
    expect(res.headers.get("location")).toBe("/settings?mailbox=Max%40Decastream.example");
    const rows = await handle.db.select().from(t.mailboxes);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ address: "max@decastream.example", status: "connected" });
  });

  it("reports missing scopes, missing offline access and forged state", async () => {
    const cookie = await sessionCookie();
    const callback = async (fetchImpl: ReturnType<typeof google>, forge = false) => {
      const { location, pending } = await start(cookie);
      const state = forge ? "forged" : location.searchParams.get("state");
      const res = await handleMailboxConnectCallback(
        new Request(`http://localhost:4000/mailboxes/google/callback?code=c&state=${state}`, {
          headers: { cookie: `${cookie}; ${MAILBOX_OAUTH_COOKIE}=${pending}` },
        }),
        { config, db: handle.db, fetchImpl },
      );
      return res.headers.get("location");
    };
    expect(await callback(google("openid email"))).toBe("/settings?mailboxError=scopes_missing");
    expect(await callback(google(undefined, null))).toBe("/settings?mailboxError=no_offline_access");
    expect(await callback(google(), true)).toBe("/settings?mailboxError=state_mismatch");
    expect(await handle.db.select().from(t.mailboxes)).toHaveLength(0);
  });

  it("is unavailable without an encryption key", async () => {
    const res = await handleMailboxConnectStart(new Request("http://localhost:4000/mailboxes/google/connect"), {
      config: { ...config, tokenKey: null },
      db: handle.db,
    });
    expect(res.headers.get("location")).toBe("/settings?mailboxError=encryption_key_missing");
  });
});
