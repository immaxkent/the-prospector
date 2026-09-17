/**
 * AES-256-GCM sealing for secrets stored in the database (OAuth token sets).
 * Format: v1.<iv>.<tag>.<ciphertext>, each part base64url. The key never touches the database.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const VERSION = "v1";

export class TokenKeyError extends Error {}

export function parseKey(raw: string | undefined): Buffer {
  if (!raw) throw new TokenKeyError("TOKEN_ENCRYPTION_KEY is not set");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new TokenKeyError("TOKEN_ENCRYPTION_KEY must be 32 bytes, base64 encoded");
  return key;
}

export function seal(plaintext: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [VERSION, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), body.toString("base64url")].join(".");
}

export function unseal(sealed: string, key: Buffer): string {
  const [version, iv, tag, body] = sealed.split(".");
  if (version !== VERSION || !iv || !tag || body === undefined) throw new Error("sealed value is malformed");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8");
}

export const sealJson = (value: unknown, key: Buffer) => seal(JSON.stringify(value), key);
export const unsealJson = <T>(sealed: string, key: Buffer) => JSON.parse(unseal(sealed, key)) as T;
