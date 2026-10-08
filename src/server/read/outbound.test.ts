import { describe, expect, it } from "vitest";
import { buildOutboundQueue, sendingAddress } from "./outbound";
import { companyRow, mailboxRow, messageRow, personRow, prospectRow } from "./testing";

const lookups = {
  prospects: new Map([["pro_1", prospectRow()]]),
  companies: new Map([["com_1", companyRow()]]),
  people: new Map([["per_1", personRow()]]),
};

const at = (iso: string) => new Date(iso);

const queue = (messages: Parameters<typeof buildOutboundQueue>[0]["messages"], over: Partial<Parameters<typeof buildOutboundQueue>[0]> = {}) =>
  buildOutboundQueue({ messages, endeavourId: "end_1", mailbox: mailboxRow(), fromAlias: null, lookups, ...over });

describe("sendingAddress", () => {
  it("is the mailbox when no alias is set", () => {
    expect(sendingAddress(mailboxRow(), null)).toBe("max@consulting.example");
  });

  it("is the alias when one is chosen", () => {
    const mailbox = mailboxRow({ aliases: [{ address: "bd@consulting.example", displayName: "BD", createdAt: "2026-09-17T08:00:00Z" }] });
    expect(sendingAddress(mailbox, "bd@consulting.example")).toBe("bd@consulting.example");
  });

  it("says when the chosen alias is no longer on the mailbox, because that is why a send would fail", () => {
    expect(sendingAddress(mailboxRow(), "gone@consulting.example")).toBe("gone@consulting.example (not on this mailbox)");
  });

  it("is null with no mailbox at all", () => {
    expect(sendingAddress(undefined, null)).toBeNull();
  });
});

describe("buildOutboundQueue", () => {
  it("carries only what is still on its way out", () => {
    const q = queue([
      messageRow({ id: "sent", sendState: "sent" }),
      messageRow({ id: "rejected", sendState: "rejected" }),
      messageRow({ id: "waiting", sendState: "pending_approval" }),
      messageRow({ id: "ready", sendState: "approved" }),
    ]);
    expect(q.messages.map((m) => m.id)).toEqual(["ready", "waiting"]);
  });

  it("leaves out inbound messages and other endeavours", () => {
    const q = queue([
      messageRow({ id: "inbound", direction: "inbound", sendState: "queued" }),
      messageRow({ id: "elsewhere", endeavourId: "end_2", sendState: "queued" }),
      messageRow({ id: "mine", sendState: "queued" }),
    ]);
    expect(q.messages.map((m) => m.id)).toEqual(["mine"]);
  });

  it("counts what waits on a person apart from what waits on the clock", () => {
    const q = queue([
      messageRow({ id: "a", sendState: "pending_approval" }),
      messageRow({ id: "b", sendState: "approved" }),
      messageRow({ id: "c", sendState: "queued" }),
      messageRow({ id: "d", sendState: "sending" }),
      messageRow({ id: "e", sendState: "failed" }),
    ]);
    expect(q).toMatchObject({ waitingOnYou: 1, readyToGo: 3, failed: 1 });
  });

  it("puts a failure above a queue that is working", () => {
    const q = queue([
      messageRow({ id: "soon", sendState: "queued", scheduledSendAt: at("2026-10-08T09:00:00Z") }),
      messageRow({ id: "broken", sendState: "failed", lastError: "mailbox rejected the token" }),
    ]);
    expect(q.messages.map((m) => m.id)).toEqual(["broken", "soon"]);
    expect(q.messages[0]?.lastError).toBe("mailbox rejected the token");
  });

  it("orders the rest by when they go, and puts what has no slot last", () => {
    // An unscheduled message is not imminent; sorting a null time as the earliest said so.
    const q = queue([
      messageRow({ id: "unscheduled", sendState: "approved", scheduledSendAt: null }),
      messageRow({ id: "later", sendState: "queued", scheduledSendAt: at("2026-10-08T15:00:00Z") }),
      messageRow({ id: "sooner", sendState: "queued", scheduledSendAt: at("2026-10-08T09:00:00Z") }),
    ]);
    expect(q.messages.map((m) => m.id)).toEqual(["sooner", "later", "unscheduled"]);
  });

  it("reports the next slot, ignoring a failure that will not take one", () => {
    const q = queue([
      messageRow({ id: "broken", sendState: "failed", scheduledSendAt: at("2026-10-08T06:00:00Z") }),
      messageRow({ id: "next", sendState: "queued", scheduledSendAt: at("2026-10-08T09:00:00Z") }),
    ]);
    expect(q.nextAt).toBe("2026-10-08T09:00:00.000Z");
  });

  it("says there is no next slot rather than inventing one", () => {
    expect(queue([messageRow({ sendState: "approved", scheduledSendAt: null })]).nextAt).toBeNull();
  });

  it("names who each one is to", () => {
    const q = queue([messageRow({ sendState: "queued" })]);
    expect(q.messages[0]?.who).toBe("Ilse Vermeer · Northbridge");
  });

  it("holds together when the message is attached to nobody", () => {
    const q = queue([messageRow({ sendState: "queued", prospectId: null })]);
    expect(q.messages[0]?.who).toBe("Unknown recipient");
  });

  it("reports the address everything goes from", () => {
    expect(queue([]).from).toBe("max@consulting.example");
    expect(queue([], { mailbox: undefined }).from).toBeNull();
  });

  it("is empty, not absent, when there is nothing to send", () => {
    expect(queue([])).toMatchObject({ messages: [], waitingOnYou: 0, readyToGo: 0, failed: 0, nextAt: null });
  });
});
