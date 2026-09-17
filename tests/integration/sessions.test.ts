import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  SESSION_TTL_MS,
  createSession,
  hashToken,
  resolveSession,
  revokeSession,
  upsertUser,
} from "../../src/server/auth/sessions";
import * as t from "../../src/server/db/schema";
import { testDb, truncateAll } from "./helpers";

const handle = testDb();
afterAll(() => handle.close());
beforeEach(() => truncateAll(handle));

describe("users", () => {
  it("upserts by lowercased email and records sign-in", async () => {
    const first = await upsertUser(handle.db, { email: "Max@Example.com", name: "Max", googleSub: "g1" });
    const second = await upsertUser(handle.db, { email: "max@example.com", name: "Max K", googleSub: "g1" });
    expect(second.id).toBe(first.id);
    expect(second).toMatchObject({ email: "max@example.com", name: "Max K" });
    expect(await handle.db.select().from(t.users)).toHaveLength(1);
  });
});

describe("sessions", () => {
  it("resolve a fresh token to its user and never store the token", async () => {
    const user = await upsertUser(handle.db, { email: "max@example.com" });
    const { token } = await createSession(handle.db, user.id, { userAgent: "test" });
    await expect(resolveSession(handle.db, token)).resolves.toEqual({ id: user.id, email: user.email, name: null });

    const [stored] = await handle.db.select().from(t.sessions);
    expect(stored!.tokenHash).toBe(hashToken(token));
    expect(JSON.stringify(stored)).not.toContain(token);
  });

  it("reject unknown, missing, expired and revoked tokens", async () => {
    const user = await upsertUser(handle.db, { email: "max@example.com" });
    const now = new Date("2026-09-17T12:00:00Z");
    const { token } = await createSession(handle.db, user.id, { now });

    await expect(resolveSession(handle.db, undefined)).resolves.toBeNull();
    await expect(resolveSession(handle.db, "not-a-token", now)).resolves.toBeNull();
    await expect(resolveSession(handle.db, token, new Date(now.getTime() + SESSION_TTL_MS + 1))).resolves.toBeNull();

    await expect(resolveSession(handle.db, token, now)).resolves.not.toBeNull();
    await revokeSession(handle.db, token, now);
    await expect(resolveSession(handle.db, token, now)).resolves.toBeNull();
  });

  it("revoking one session leaves the others signed in", async () => {
    const user = await upsertUser(handle.db, { email: "max@example.com" });
    const a = await createSession(handle.db, user.id);
    const b = await createSession(handle.db, user.id);
    await revokeSession(handle.db, a.token);
    await expect(resolveSession(handle.db, b.token)).resolves.not.toBeNull();
  });
});
