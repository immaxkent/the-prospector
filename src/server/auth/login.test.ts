import { describe, expect, it } from "vitest";
import { decodePending, encodePending, safeReturnTo } from "./login";

describe("pending login cookie", () => {
  it("round-trips", () => {
    const p = { state: "s", verifier: "v", returnTo: "/inbox" };
    expect(decodePending(encodePending(p))).toEqual(p);
  });

  it("rejects missing, garbled and incomplete values", () => {
    expect(decodePending(undefined)).toBeNull();
    expect(decodePending("%%%")).toBeNull();
    expect(decodePending(Buffer.from('{"state":"s"}').toString("base64url"))).toBeNull();
  });

  it("sanitises a tampered return path", () => {
    const raw = encodePending({ state: "s", verifier: "v", returnTo: "https://evil.example" });
    expect(decodePending(raw)?.returnTo).toBe("/");
  });
});

describe("safeReturnTo", () => {
  it("keeps same-origin paths only", () => {
    expect(safeReturnTo("/endeavours/end_1?tab=runs")).toBe("/endeavours/end_1?tab=runs");
    expect(safeReturnTo("//evil.example")).toBe("/");
    expect(safeReturnTo("/\\evil.example")).toBe("/");
    expect(safeReturnTo("https://evil.example")).toBe("/");
    expect(safeReturnTo(null)).toBe("/");
  });
});
