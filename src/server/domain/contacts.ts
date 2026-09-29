/**
 * Ways to reach a company.
 *
 * Research could only record a named person's email, and that is the one contact detail the
 * public web almost never carries. So ten well-matched companies came back with nothing, and
 * because a missing contact drags `contactability` down and the prompt says to reject when
 * there is no usable route, the schema's silence became a rejection.
 *
 * Web3 teams in particular answer on Discord and Telegram long before they answer a named
 * inbox, and nearly every company has a generic one. Those are recorded here.
 *
 * Recording is not sending. v1 sends email only; a Discord handle is intelligence for the
 * operator, who can open the conversation themselves and hand the thread back.
 */

export const CONTACT_CHANNELS = ["email", "form", "discord", "telegram", "x", "linkedin", "other"] as const;
export type ContactChannel = (typeof CONTACT_CHANNELS)[number];

export interface CompanyContact {
  channel: ContactChannel;
  /** The address, handle or URL exactly as the source gave it. */
  value: string;
  /** Where it was read. Contacts are evidence like anything else. */
  sourceRef?: string;
}

/** Channels this app can actually send through today. Everything else is for the operator. */
export const SENDABLE_CHANNELS: readonly ContactChannel[] = ["email"];

export const isSendable = (c: CompanyContact) => SENDABLE_CHANNELS.includes(c.channel);

/** Generic inboxes: usable, but worth far less than a named person. */
const GENERIC_LOCAL_PARTS = new Set([
  "hello",
  "info",
  "contact",
  "team",
  "support",
  "enquiries",
  "inquiries",
  "sales",
  "partnerships",
  "bd",
  "hi",
  "admin",
  "office",
]);

export function isGenericInbox(address: string): boolean {
  const local = address.trim().toLowerCase().split("@")[0] ?? "";
  // "hello+bd@" and "info.uk@" are the same inbox wearing a tag.
  const base = local.split(/[+.]/)[0] ?? "";
  return GENERIC_LOCAL_PARTS.has(base);
}

/**
 * How reachable a company is, on the scale `contactability` is scored on.
 *
 * A named person's address is the thing worth having; a generic inbox is usable but
 * converts worse; a handle is a route the operator can open by hand. None of them is
 * nothing, which is the point — the old schema could only say "named email or bust".
 */
export function contactabilityScore(input: { personEmail?: string | null; contacts: readonly CompanyContact[] }): number {
  if (input.personEmail && !isGenericInbox(input.personEmail)) return 10;
  const emails = input.contacts.filter((c) => c.channel === "email");
  if (emails.some((c) => !isGenericInbox(c.value))) return 9;
  if (input.personEmail || emails.length > 0) return 6;
  if (input.contacts.some((c) => c.channel === "discord" || c.channel === "telegram")) return 4;
  if (input.contacts.length > 0) return 3;
  return 0;
}

/** What to try first. Named address, then generic inbox, then whatever a human can open. */
export function preferredContact(input: {
  personEmail?: string | null;
  contacts: readonly CompanyContact[];
}): { channel: ContactChannel; value: string; named: boolean } | null {
  if (input.personEmail) {
    return { channel: "email", value: input.personEmail, named: !isGenericInbox(input.personEmail) };
  }
  const emails = input.contacts.filter((c) => c.channel === "email");
  const named = emails.find((c) => !isGenericInbox(c.value));
  if (named) return { channel: "email", value: named.value, named: true };
  const generic = emails[0];
  if (generic) return { channel: "email", value: generic.value, named: false };
  const first = input.contacts[0];
  return first ? { channel: first.channel, value: first.value, named: false } : null;
}

/** Drops duplicates and blanks, keeping the first sighting of each channel-and-value. */
export function dedupeContacts(contacts: readonly CompanyContact[]): CompanyContact[] {
  const seen = new Set<string>();
  const out: CompanyContact[] = [];
  for (const contact of contacts) {
    const value = contact.value.trim();
    if (!value) continue;
    const key = `${contact.channel}:${value.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...contact, value });
  }
  return out;
}
