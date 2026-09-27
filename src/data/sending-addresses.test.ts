import { describe, expect, it } from "vitest";
import type { Mailbox } from "./types";
import { parseSendingAddress, sendingAddressKey, sendingAddresses } from "./sending-addresses";

const mailbox = (over: Partial<Mailbox> & Pick<Mailbox, "id" | "address">): Mailbox =>
  ({
    displayName: "Max",
    provider: "google",
    status: "connected",
    dailyCap: 30,
    capToday: 30,
    sentToday: 0,
    warmingUp: false,
    quietHours: "20:00 – 07:00",
    limits: { dailyCap: 30, timezone: "Europe/London", quietHours: { start: 20, end: 7 }, warmup: null },
    endeavourIds: [],
    aliases: [],
    canCreateAliases: false,
    ...over,
  }) as Mailbox;

const goodpaper = mailbox({
  id: "mbx_1",
  address: "max@goodpaper.io",
  aliases: [{ address: "partnerships@immaxkent.xyz", displayName: "Max Kent" }],
});

describe("sendingAddresses", () => {
  it("offers the account and each of its aliases", () => {
    expect(sendingAddresses([goodpaper])).toEqual([
      { key: "mbx_1", mailboxId: "mbx_1", address: "max@goodpaper.io", alias: null, label: "max@goodpaper.io" },
      {
        key: "mbx_1::partnerships@immaxkent.xyz",
        mailboxId: "mbx_1",
        address: "partnerships@immaxkent.xyz",
        alias: "partnerships@immaxkent.xyz",
        label: "partnerships@immaxkent.xyz — via max@goodpaper.io",
      },
    ]);
  });

  it("names the account behind an alias, because its sends count against that cap", () => {
    const alias = sendingAddresses([goodpaper]).find((o) => o.alias);
    expect(alias?.label).toContain("via max@goodpaper.io");
  });

  it("leaves out mailboxes that cannot send", () => {
    const broken = mailbox({ id: "mbx_2", address: "old@idw3.io", status: "needs_reauth" });
    expect(sendingAddresses([goodpaper, broken]).map((o) => o.mailboxId)).toEqual(["mbx_1", "mbx_1"]);
  });

  it("is empty when nothing is connected", () => {
    expect(sendingAddresses([])).toEqual([]);
  });
});

describe("parseSendingAddress", () => {
  it("reads an account back", () => {
    expect(parseSendingAddress("mbx_1")).toEqual({ mailboxId: "mbx_1", alias: null });
  });

  it("reads an alias back", () => {
    expect(parseSendingAddress("mbx_1::partnerships@immaxkent.xyz")).toEqual({
      mailboxId: "mbx_1",
      alias: "partnerships@immaxkent.xyz",
    });
  });

  it("treats the empty option as no choice", () => {
    expect(parseSendingAddress("")).toBeNull();
  });

  it("round-trips every option it produces", () => {
    for (const option of sendingAddresses([goodpaper])) {
      expect(parseSendingAddress(option.key)).toEqual({ mailboxId: option.mailboxId, alias: option.alias });
    }
  });
});

describe("sendingAddressKey", () => {
  const options = sendingAddresses([goodpaper]);

  it("selects the account when no alias is set", () => {
    expect(sendingAddressKey(options, "mbx_1", null)).toBe("mbx_1");
  });

  it("selects the alias when one is set", () => {
    expect(sendingAddressKey(options, "mbx_1", "partnerships@immaxkent.xyz")).toBe("mbx_1::partnerships@immaxkent.xyz");
  });

  it("matches an alias whatever case it was stored in", () => {
    expect(sendingAddressKey(options, "mbx_1", "Partnerships@ImMaxKent.xyz")).toBe("mbx_1::partnerships@immaxkent.xyz");
  });

  it("falls back to the account when the alias is gone", () => {
    // The mailbox can still send; showing nothing would suggest otherwise.
    expect(sendingAddressKey(options, "mbx_1", "removed@immaxkent.xyz")).toBe("mbx_1");
  });

  it("selects nothing when the mailbox is unset or no longer connected", () => {
    expect(sendingAddressKey(options, null, null)).toBe("");
    expect(sendingAddressKey(options, "mbx_gone", null)).toBe("");
  });
});
