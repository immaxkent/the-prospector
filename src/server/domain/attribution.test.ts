import { describe, expect, it } from "vitest";
import { attributeReply, domainOf, isPublicDomain, replyAddress } from "./attribution";

describe("replyAddress", () => {
  it("strips the display name, because headers carry both forms", () => {
    expect(replyAddress("Ilse Vermeer <ilse@northbridge.example>")).toBe("ilse@northbridge.example");
    expect(replyAddress("ilse@northbridge.example")).toBe("ilse@northbridge.example");
  });

  it("lowercases, so a match is not lost to capitals", () => {
    expect(replyAddress("Ilse@Northbridge.Example")).toBe("ilse@northbridge.example");
  });

  it("is null for anything that is not an address", () => {
    expect(replyAddress(null)).toBeNull();
    expect(replyAddress("")).toBeNull();
    expect(replyAddress("Mailer Daemon")).toBeNull();
  });
});

describe("domainOf", () => {
  it("takes what is after the last @", () => {
    expect(domainOf("ilse@northbridge.example")).toBe("northbridge.example");
    expect(domainOf("odd@name@northbridge.example")).toBe("northbridge.example");
  });

  it("is null without one", () => {
    expect(domainOf(null)).toBeNull();
    expect(domainOf("@northbridge.example")).toBeNull();
  });
});

describe("isPublicDomain", () => {
  it("knows the free hosts, where a shared domain means nothing", () => {
    expect(isPublicDomain("gmail.com")).toBe(true);
    expect(isPublicDomain("northbridge.example")).toBe(false);
    expect(isPublicDomain(null)).toBe(false);
  });
});

describe("attributeReply", () => {
  const thread = { id: "thr_1", prospectId: "pro_1", endeavourId: "end_1" };

  it("takes the thread we sent on, which cannot be coincidence", () => {
    expect(attributeReply({ from: "someone@else.example", candidate: { thread } })).toEqual({
      threadId: "thr_1",
      prospectId: "pro_1",
      endeavourId: "end_1",
      reason: "thread",
      needsReview: false,
    });
  });

  it("flags a thread of ours with nothing attached, because that is the thing needing attention", () => {
    const orphan = { id: "thr_1", prospectId: null, endeavourId: "end_1" };
    expect(attributeReply({ from: "a@b.example", candidate: { thread: orphan } })).toMatchObject({
      reason: "thread",
      prospectId: null,
      needsReview: true,
    });
  });

  it("falls to the exact address, and trusts it", () => {
    expect(
      attributeReply({ from: "ilse@northbridge.example", candidate: { byAddress: { id: "pro_1", endeavourId: "end_1" } } }),
    ).toMatchObject({ reason: "address", prospectId: "pro_1", needsReview: false });
  });

  it("prefers the thread over the address when both are there", () => {
    const a = attributeReply({
      from: "ilse@northbridge.example",
      candidate: { thread, byAddress: { id: "pro_other", endeavourId: "end_1" } },
    });
    expect(a).toMatchObject({ reason: "thread", prospectId: "pro_1" });
  });

  it("attributes a colleague on the company's own domain, and asks a person to confirm", () => {
    const a = attributeReply({
      from: "Tomas <tomas@northbridge.example>",
      candidate: { byDomain: [{ id: "pro_1", endeavourId: "end_1" }] },
    });
    expect(a).toMatchObject({ reason: "domain", prospectId: "pro_1", needsReview: true });
  });

  it("will not guess between two prospects at the same company", () => {
    // A guess that picks wrong closes the wrong conversation, which is worse than asking.
    const a = attributeReply({
      from: "tomas@northbridge.example",
      candidate: { byDomain: [{ id: "pro_1", endeavourId: "end_1" }, { id: "pro_2", endeavourId: "end_1" }] },
    });
    expect(a).toMatchObject({ reason: "none", prospectId: null, needsReview: true });
  });

  it("never matches on a free mail host, where two prospects are not colleagues", () => {
    const a = attributeReply({
      from: "someone@gmail.com",
      candidate: { byDomain: [{ id: "pro_1", endeavourId: "end_1" }] },
    });
    expect(a).toMatchObject({ reason: "none", prospectId: null });
  });

  it("says none rather than inventing an owner", () => {
    expect(attributeReply({ from: "stranger@nowhere.example", candidate: {} })).toEqual({
      threadId: null,
      prospectId: null,
      endeavourId: null,
      reason: "none",
      needsReview: true,
    });
  });

  it("holds together with no sender at all", () => {
    expect(attributeReply({ from: null, candidate: {} })).toMatchObject({ reason: "none" });
  });
});
