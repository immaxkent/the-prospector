import { createHash } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import type { Database } from "../db/client";
import { sessions, users } from "../db/schema";
import { newId } from "../ids";
import { randomToken } from "./google-oauth";

export const SESSION_COOKIE = "prospector_session";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
}

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function upsertUser(db: Database, profile: { email: string; name?: string | undefined; googleSub?: string | undefined }) {
  const email = profile.email.trim().toLowerCase();
  const now = new Date();
  const [row] = await db
    .insert(users)
    .values({ id: newId("user"), email, name: profile.name ?? null, googleSub: profile.googleSub ?? null, lastSignInAt: now })
    .onConflictDoUpdate({
      target: users.email,
      set: { name: profile.name ?? null, googleSub: profile.googleSub ?? null, lastSignInAt: now },
    })
    .returning({ id: users.id, email: users.email, name: users.name });
  return row!;
}

/** Returns the cookie token. Only its hash is stored. */
export async function createSession(db: Database, userId: string, opts: { userAgent?: string | null; now?: Date } = {}) {
  const token = randomToken(32);
  const now = opts.now ?? new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  await db.insert(sessions).values({
    id: newId("session"),
    userId,
    tokenHash: hashToken(token),
    expiresAt,
    userAgent: opts.userAgent ?? null,
  });
  return { token, expiresAt };
}

export async function resolveSession(db: Database, token: string | undefined, now = new Date()): Promise<SessionUser | null> {
  if (!token) return null;
  const [row] = await db
    .select({ id: users.id, email: users.email, name: users.name })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, now), isNull(sessions.revokedAt)))
    .limit(1);
  return row ?? null;
}

export async function revokeSession(db: Database, token: string | undefined, now = new Date()) {
  if (!token) return;
  await db.update(sessions).set({ revokedAt: now }).where(eq(sessions.tokenHash, hashToken(token)));
}
