/**
 * Which prospect a reply belongs to, and how we know.
 *
 * Twenty-five replies arrived and none was attributed, which makes every reply manual, every
 * conversion rate wrong, and leaves the follow-up sequence chasing people who have already
 * answered.
 *
 * The order is strongest evidence first, and the reason is recorded rather than inferred
 * later. Without it a reply matched on a shared company domain — a colleague answering on
 * behalf of the person we wrote to — is indistinguishable from one matched on the thread we
 * sent, and the first is a guess while the second is a fact.
 */

/** How a reply was attributed, in descending order of how much it can be trusted. */
export const ATTRIBUTION_REASONS = ["thread", "address", "domain", "none"] as const;
export type AttributionReason = (typeof ATTRIBUTION_REASONS)[number];

export interface ReplyCandidate {
  /** A thread of ours whose external id the reply carries. The strongest evidence there is. */
  thread?: { id: string; prospectId: string | null; endeavourId: string | null } | undefined;
  /** A prospect whose named person has exactly this address. */
  byAddress?: { id: string; endeavourId: string } | undefined;
  /** Prospects at the company the address belongs to, best first. */
  byDomain?: readonly { id: string; endeavourId: string }[] | undefined;
}

export interface Attribution {
  threadId: string | null;
  prospectId: string | null;
  endeavourId: string | null;
  reason: AttributionReason;
  /** Whether a person should confirm it. True for anything weaker than the two facts. */
  needsReview: boolean;
}

/**
 * The address a reply came from, lowercased, with any display name stripped.
 *
 * Gmail gives "Ilse Vermeer <ilse@northbridge.example>" in some headers and the bare address
 * in others, and a match on the wrong one is a match on nothing.
 */
export function replyAddress(from: string | null | undefined): string | null {
  if (!from) return null;
  const angled = /<([^>]+)>/.exec(from);
  const raw = (angled?.[1] ?? from).trim().toLowerCase();
  return raw.includes("@") ? raw : null;
}

export function domainOf(address: string | null): string | null {
  const at = address?.lastIndexOf("@") ?? -1;
  return at > 0 ? address!.slice(at + 1) : null;
}

/**
 * Free mail hosts, where a shared domain means nothing at all.
 *
 * Two prospects on gmail.com are not colleagues, and attributing one's reply to the other is
 * worse than leaving it for a person: it closes the wrong conversation.
 */
const PUBLIC_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "yahoo.com",
  "icloud.com",
  "me.com",
  "proton.me",
  "protonmail.com",
  "aol.com",
  "gmx.com",
  "mail.com",
  "yandex.com",
  "qq.com",
]);

export const isPublicDomain = (domain: string | null) => !!domain && PUBLIC_DOMAINS.has(domain);

export function attributeReply(input: { from: string | null; candidate: ReplyCandidate }): Attribution {
  const { thread, byAddress, byDomain } = input.candidate;

  // A thread we sent on is the one piece of evidence that cannot be coincidence.
  if (thread) {
    return {
      threadId: thread.id,
      prospectId: thread.prospectId,
      endeavourId: thread.endeavourId,
      reason: "thread",
      // A thread of ours with nothing attached is itself the thing needing attention.
      needsReview: thread.prospectId === null,
    };
  }

  if (byAddress) {
    return {
      threadId: null,
      prospectId: byAddress.id,
      endeavourId: byAddress.endeavourId,
      reason: "address",
      needsReview: false,
    };
  }

  const address = replyAddress(input.from);
  const domain = domainOf(address);
  const colleagues = byDomain ?? [];
  /*
   * One prospect at the company, on a domain the company owns, is a colleague answering.
   * Two is a guess between them, and a guess that picks wrong closes the wrong conversation,
   * so it goes to a person instead.
   */
  if (!isPublicDomain(domain) && colleagues.length === 1) {
    const only = colleagues[0]!;
    return { threadId: null, prospectId: only.id, endeavourId: only.endeavourId, reason: "domain", needsReview: true };
  }

  return { threadId: null, prospectId: null, endeavourId: null, reason: "none", needsReview: true };
}
