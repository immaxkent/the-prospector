import { describe, expect, it } from "vitest";
import { buildRawMessage, decodeRawMessage } from "./message";

const base = {
  fromName: "Max Kent",
  fromAddress: "max@consulting.example",
  toName: "Ilse Vermeer",
  toAddress: "ilse@northbridge.example",
  subject: "Bridge contract before mainnet",
  body: "Your postmortem mentions missing invariant tests.\nWorth a look?",
  unsubscribeMailto: "max@consulting.example",
};

const decoded = (over = {}) => decodeRawMessage(buildRawMessage({ ...base, ...over }));

describe("buildRawMessage", () => {
  it("writes addresses, subject and a plain text body with CRLF line endings", () => {
    const message = decoded();
    expect(message).toContain("From: Max Kent <max@consulting.example>");
    expect(message).toContain("To: Ilse Vermeer <ilse@northbridge.example>");
    expect(message).toContain("Subject: Bridge contract before mainnet");
    expect(message).toContain('Content-Type: text/plain; charset="UTF-8"');
    expect(message).toContain("invariant tests.\r\nWorth a look?");
  });

  it("always offers a way out", () => {
    const message = decoded();
    expect(message).toContain("List-Unsubscribe: <mailto:max@consulting.example?subject=unsubscribe>");
    expect(message).toContain('Reply "unsubscribe" and I will not contact you again.');
  });

  it("encodes non-ASCII names and subjects", () => {
    const message = decoded({ toName: "Ilse Vermeer ☕", subject: "Före mainnet" });
    expect(message).toContain("To: =?UTF-8?B?");
    expect(message).toContain("Subject: =?UTF-8?B?");
    expect(message).not.toContain("Före");
  });

  it("threads a reply with In-Reply-To and References", () => {
    const message = decoded({ inReplyTo: "<abc@mail.example>", references: ["<abc@mail.example>"] });
    expect(message).toContain("In-Reply-To: <abc@mail.example>");
    expect(message).toContain("References: <abc@mail.example>");
    expect(decoded()).not.toContain("In-Reply-To");
  });

  it("falls back to a bare address when no name is known", () => {
    expect(decoded({ toName: null })).toContain("To: ilse@northbridge.example");
  });
});
