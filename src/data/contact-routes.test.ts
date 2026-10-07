import { describe, expect, it } from "vitest";
import { contactRoutes, foundBy } from "./contact-routes";

describe("foundBy", () => {
  it("takes the stamp when there is one", () => {
    expect(foundBy({ addedBy: "operator" })).toBe("operator");
    expect(foundBy({ addedBy: "agent" })).toBe("agent");
  });

  it("guesses from the source for rows written before the stamp existed", () => {
    // Research always cites the page it read; a person typing an address rarely does.
    expect(foundBy({ sourceRef: "https://b.com/contact" })).toBe("agent");
    expect(foundBy({})).toBe("operator");
    expect(foundBy({ sourceRef: "a friend told me" })).toBe("operator");
  });

  it("prefers the stamp over the guess when they disagree", () => {
    expect(foundBy({ sourceRef: "https://b.com", addedBy: "operator" })).toBe("operator");
  });
});

describe("contactRoutes", () => {
  it("puts a named address first and marks it as the one that would be used", () => {
    const routes = contactRoutes({
      personEmail: "ilse@northbridge.example",
      linkedinUrl: null,
      contacts: [
        { channel: "discord", value: "discord.gg/nb" },
        { channel: "email", value: "hello@northbridge.example" },
      ],
    });
    expect(routes.map((r) => r.value)).toEqual([
      "ilse@northbridge.example",
      "hello@northbridge.example",
      "discord.gg/nb",
    ]);
    expect(routes.filter((r) => r.preferred)).toHaveLength(1);
    expect(routes[0]).toMatchObject({ preferred: true, sendable: true, named: true });
  });

  it("falls to a generic inbox when nobody is named, and says it is generic", () => {
    const routes = contactRoutes({
      personEmail: null,
      linkedinUrl: null,
      contacts: [{ channel: "email", value: "hello@northbridge.example" }],
    });
    expect(routes[0]).toMatchObject({ preferred: true, named: false, sendable: true });
  });

  it("prefers nothing when nothing can be sent to, rather than pointing at a handle", () => {
    const routes = contactRoutes({
      personEmail: null,
      linkedinUrl: null,
      contacts: [{ channel: "telegram", value: "t.me/nb" }],
    });
    expect(routes.some((r) => r.preferred)).toBe(false);
    expect(routes[0]).toMatchObject({ sendable: false });
  });

  it("carries where each route came from, and who found it", () => {
    const routes = contactRoutes({
      personEmail: null,
      linkedinUrl: null,
      contacts: [
        {
          channel: "email",
          value: "hello@a.com",
          sourceRef: "https://a.com/contact",
          addedBy: "agent",
        },
        { channel: "email", value: "bd@a.com", addedBy: "operator" },
      ],
    });
    expect(routes.map((r) => [r.value, r.foundBy, r.sourceRef])).toEqual([
      ["hello@a.com", "agent", "https://a.com/contact"],
      ["bd@a.com", "operator", null],
    ]);
  });

  it("includes a LinkedIn profile as a route the operator opens, not one to send to", () => {
    const routes = contactRoutes({
      personEmail: null,
      linkedinUrl: "https://linkedin.com/in/ilse",
      contacts: [],
    });
    expect(routes[0]).toMatchObject({ channel: "linkedin", sendable: false, preferred: false });
  });

  it("returns nothing at all when there is nothing at all", () => {
    expect(contactRoutes({ personEmail: null, linkedinUrl: null, contacts: [] })).toEqual([]);
  });
});
