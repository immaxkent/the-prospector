/**
 * Every route to a prospect, ranked and labelled.
 *
 * Shared rather than server-side: the prospect screen shows the routes, and the design
 * fixtures have to produce the same shape as the database read or the two screens disagree
 * about what they mean. src/server is server-only by build rule, so this is the half that
 * both sides can see.
 */
import { isGenericInbox } from "@/lib/inbox";
import type { ContactRoute } from "./types";

/**
 * Who found a contact.
 *
 * Stamped on write since the field existed. For rows older than it the only evidence is the
 * source: research always cites a page it read, and an operator typing an address usually
 * cites nothing. A guess, kept in one place and labelled as one.
 */
export const foundBy = (c: {
  sourceRef?: string | undefined;
  addedBy?: "agent" | "operator" | undefined;
}) => c.addedBy ?? (c.sourceRef?.startsWith("http") ? "agent" : "operator");

/** Channels this app can actually send through today. Everything else is for the operator. */
const SENDABLE = new Set(["email"]);

/**
 * Every route to this prospect, best first, each saying where it came from.
 *
 * Exactly one is marked preferred — the one an email would go to — and it is marked rather
 * than merely sorted first, because "this is what would be used" is the question an operator
 * is actually asking when they look at a list of four addresses.
 */
export function contactRoutes(input: {
  personEmail: string | null;
  linkedinUrl: string | null;
  contacts: readonly {
    channel: string;
    value: string;
    sourceRef?: string | undefined;
    addedBy?: "agent" | "operator" | undefined;
  }[];
}): ContactRoute[] {
  const routes: ContactRoute[] = [];
  if (input.personEmail) {
    routes.push({
      channel: "email",
      value: input.personEmail,
      foundBy: "agent",
      sourceRef: null,
      preferred: false,
      sendable: true,
      named: !isGenericInbox(input.personEmail),
    });
  }
  if (input.linkedinUrl) {
    routes.push({
      channel: "linkedin",
      value: input.linkedinUrl,
      foundBy: "agent",
      sourceRef: null,
      preferred: false,
      sendable: false,
      named: true,
    });
  }
  for (const c of input.contacts) {
    routes.push({
      channel: c.channel,
      value: c.value,
      foundBy: foundBy(c),
      sourceRef: c.sourceRef ?? null,
      preferred: false,
      sendable: SENDABLE.has(c.channel),
      named: c.channel === "email" ? !isGenericInbox(c.value) : false,
    });
  }

  // Named address, then any address, then whatever a person can open. Same order of
  // preference the sender uses, so the screen cannot disagree with what would happen.
  const rank = (r: ContactRoute) => (r.sendable && r.named ? 0 : r.sendable ? 1 : 2);
  routes.sort((a, b) => rank(a) - rank(b));
  const first = routes.find((r) => r.sendable);
  if (first) first.preferred = true;
  return routes;
}
