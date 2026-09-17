import { describe, expect, it } from "vitest";
import { isAllowed, parseAllowlist } from "./allowlist";

describe("parseAllowlist", () => {
  it("splits, trims, lowercases and drops blanks", () => {
    expect(parseAllowlist(" Max@Example.com, ,@team.io ")).toEqual(["max@example.com", "@team.io"]);
    expect(parseAllowlist(undefined)).toEqual([]);
  });
});

describe("isAllowed", () => {
  const list = parseAllowlist("max@example.com,@team.io");

  it("matches exact addresses case-insensitively", () => {
    expect(isAllowed("MAX@example.com", list)).toBe(true);
    expect(isAllowed("other@example.com", list)).toBe(false);
  });

  it("matches whole domains only on the exact domain", () => {
    expect(isAllowed("anyone@team.io", list)).toBe(true);
    expect(isAllowed("anyone@evilteam.io", list)).toBe(false);
    expect(isAllowed("anyone@team.io.evil.com", list)).toBe(false);
  });

  it("rejects malformed addresses and an empty allowlist", () => {
    expect(isAllowed("@team.io", list)).toBe(false);
    expect(isAllowed("max@", list)).toBe(false);
    expect(isAllowed("max@example.com", [])).toBe(false);
  });
});
