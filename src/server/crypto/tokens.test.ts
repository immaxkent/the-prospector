import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { TokenKeyError, parseKey, seal, sealJson, unseal, unsealJson } from "./tokens";

const key = randomBytes(32);

describe("parseKey", () => {
  it("accepts a 32-byte base64 key and rejects anything else", () => {
    expect(parseKey(key.toString("base64"))).toEqual(key);
    expect(() => parseKey(undefined)).toThrow(TokenKeyError);
    expect(() => parseKey(randomBytes(16).toString("base64"))).toThrow("32 bytes");
  });
});

describe("seal and unseal", () => {
  it("round-trips and never contains the plaintext", () => {
    const sealed = seal("refresh-token-secret", key);
    expect(sealed.startsWith("v1.")).toBe(true);
    expect(sealed).not.toContain("refresh-token-secret");
    expect(unseal(sealed, key)).toBe("refresh-token-secret");
  });

  it("uses a fresh IV every time", () => {
    expect(seal("same", key)).not.toBe(seal("same", key));
  });

  it("fails with the wrong key or a tampered value", () => {
    const sealed = seal("secret", key);
    expect(() => unseal(sealed, randomBytes(32))).toThrow();
    const parts = sealed.split(".");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(() => unseal(parts.join("."), key)).toThrow();
    expect(() => unseal("garbage", key)).toThrow("malformed");
  });

  it("round-trips JSON token sets", () => {
    const tokens = { refresh_token: "r", access_token: "a", expires_at: 123 };
    expect(unsealJson(sealJson(tokens, key), key)).toEqual(tokens);
  });
});
