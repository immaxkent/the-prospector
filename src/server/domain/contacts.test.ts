import { describe, expect, it } from "vitest";
import {
  contactabilityScore,
  dedupeContacts,
  isGenericInbox,
  isSendable,
  preferredContact,
  type CompanyContact,
} from "./contacts";

const email = (value: string): CompanyContact => ({ channel: "email", value });
const discord = (value = "discord.gg/team"): CompanyContact => ({ channel: "discord", value });

describe("isGenericInbox", () => {
  it("knows the usual shared inboxes", () => {
    for (const a of ["hello@x.com", "info@x.com", "team@x.com", "partnerships@x.com", "sales@x.com"]) {
      expect(isGenericInbox(a)).toBe(true);
    }
  });

  it("sees through a tag or a dotted suffix", () => {
    expect(isGenericInbox("hello+bd@x.com")).toBe(true);
    expect(isGenericInbox("info.uk@x.com")).toBe(true);
  });

  it("does not mistake a person for an inbox", () => {
    for (const a of ["ilse@x.com", "i.vermeer@x.com", "ilse.vermeer@x.com"]) {
      expect(isGenericInbox(a)).toBe(false);
    }
  });

  it("is not confused by case or whitespace", () => {
    expect(isGenericInbox("  HELLO@X.COM ")).toBe(true);
  });
});

describe("contactabilityScore", () => {
  it("rates a named person's address highest", () => {
    expect(contactabilityScore({ personEmail: "ilse@x.com", contacts: [] })).toBe(10);
  });

  it("rates a named company address just below a known person", () => {
    expect(contactabilityScore({ contacts: [email("ilse.vermeer@x.com")] })).toBe(9);
  });

  it("rates a generic inbox as usable but worth less", () => {
    expect(contactabilityScore({ contacts: [email("hello@x.com")] })).toBe(6);
    expect(contactabilityScore({ personEmail: "info@x.com", contacts: [] })).toBe(6);
  });

  it("rates a handle as a route a human can open", () => {
    expect(contactabilityScore({ contacts: [discord()] })).toBe(4);
    expect(contactabilityScore({ contacts: [{ channel: "telegram", value: "@team" }] })).toBe(4);
  });

  it("still counts something over nothing", () => {
    expect(contactabilityScore({ contacts: [{ channel: "form", value: "https://x.com/contact" }] })).toBe(3);
  });

  it("scores nothing only when there is genuinely nothing", () => {
    // This is what every one of the first run's ten companies scored, because the schema
    // had nowhere to put anything else.
    expect(contactabilityScore({ contacts: [] })).toBe(0);
    expect(contactabilityScore({ personEmail: null, contacts: [] })).toBe(0);
  });

  it("takes the best route on offer, not the first", () => {
    const mixed = [discord(), email("hello@x.com"), email("ilse.vermeer@x.com")];
    expect(contactabilityScore({ contacts: mixed })).toBe(9);
  });
});

describe("preferredContact", () => {
  it("prefers the known person over anything on the company", () => {
    expect(preferredContact({ personEmail: "ilse@x.com", contacts: [email("hello@x.com")] })).toEqual({
      channel: "email",
      value: "ilse@x.com",
      named: true,
    });
  });

  it("prefers a named company address over a generic one", () => {
    expect(preferredContact({ contacts: [email("hello@x.com"), email("ilse.vermeer@x.com")] })).toMatchObject({
      value: "ilse.vermeer@x.com",
      named: true,
    });
  });

  it("falls back to a generic inbox, and says it is not a named one", () => {
    expect(preferredContact({ contacts: [email("hello@x.com")] })).toEqual({
      channel: "email",
      value: "hello@x.com",
      named: false,
    });
  });

  it("offers a handle when there is no address at all", () => {
    expect(preferredContact({ contacts: [discord()] })).toMatchObject({ channel: "discord", named: false });
  });

  it("returns nothing when there is nothing", () => {
    expect(preferredContact({ contacts: [] })).toBeNull();
  });
});

describe("what can actually be sent", () => {
  it("sends email and nothing else, for now", () => {
    expect(isSendable(email("hello@x.com"))).toBe(true);
    expect(isSendable(discord())).toBe(false);
  });
});

describe("dedupeContacts", () => {
  it("keeps the first sighting and drops repeats, whatever the case", () => {
    const out = dedupeContacts([email("Hello@X.com"), email("hello@x.com"), discord()]);
    expect(out).toHaveLength(2);
    expect(out[0]!.value).toBe("Hello@X.com");
  });

  it("keeps the same value on two different channels", () => {
    const out = dedupeContacts([{ channel: "x", value: "@team" }, { channel: "telegram", value: "@team" }]);
    expect(out).toHaveLength(2);
  });

  it("drops blanks and trims what it keeps", () => {
    expect(dedupeContacts([email("  "), email(" hello@x.com ")])).toEqual([{ channel: "email", value: "hello@x.com" }]);
  });
});
