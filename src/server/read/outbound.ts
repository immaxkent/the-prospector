/**
 * What is about to go out.
 *
 * Approving a draft was the last the operator saw of it: between approval and arrival the
 * message passed through a pacing queue, a quiet-hours window and a daily cap, none of which
 * were on a screen. So "I approved eight this morning" and "two have gone" both looked
 * normal, and a mailbox that had stopped sending looked exactly like one that was pacing
 * itself properly.
 */
import type { OutboundQueue, OutboundState, QueuedMessage } from "@/data/types";
import {
  iso,
  type MailboxRow,
  type MessageRow,
  type ProspectRow,
  type CompanyRow,
  type PersonRow,
} from "./rows";

/** The states that are still on their way out. Sent and rejected are done with. */
export const IN_FLIGHT: readonly OutboundState[] = [
  "pending_approval",
  "approved",
  "queued",
  "sending",
  "failed",
];

export interface QueueLookups {
  prospects: ReadonlyMap<string, ProspectRow>;
  companies: ReadonlyMap<string, CompanyRow>;
  people: ReadonlyMap<string, PersonRow>;
}

function whoFor(message: MessageRow, l: QueueLookups): string {
  const prospect = message.prospectId ? l.prospects.get(message.prospectId) : undefined;
  const person = prospect?.personId ? l.people.get(prospect.personId) : undefined;
  const company = prospect?.companyId ? l.companies.get(prospect.companyId) : undefined;
  if (person && company) return `${person.name} · ${company.name}`;
  return person?.name ?? company?.name ?? "Unknown recipient";
}

/** The address a message actually leaves from: the endeavour's alias, or the mailbox itself. */
export function sendingAddress(
  mailbox: MailboxRow | undefined,
  fromAlias: string | null,
): string | null {
  if (!mailbox) return null;
  if (!fromAlias) return mailbox.address;
  const alias = mailbox.aliases.find((a) => a.address === fromAlias);
  // An alias the mailbox no longer carries is said plainly: it is why a send would fail.
  return alias ? alias.address : `${fromAlias} (not on this mailbox)`;
}

export function buildOutboundQueue(input: {
  messages: readonly MessageRow[];
  endeavourId: string;
  mailbox: MailboxRow | undefined;
  fromAlias: string | null;
  lookups: QueueLookups;
}): OutboundQueue {
  const states = new Set<string>(IN_FLIGHT);
  const messages = input.messages
    .filter(
      (m) =>
        m.endeavourId === input.endeavourId &&
        m.direction === "outbound" &&
        states.has(m.sendState ?? ""),
    )
    .map((m): QueuedMessage => ({
      id: m.id,
      prospectId: m.prospectId,
      who: whoFor(m, input.lookups),
      subject: m.subject,
      state: m.sendState as OutboundState,
      goesAt: m.scheduledSendAt ? iso(m.scheduledSendAt) : null,
      attempts: m.sendAttempts,
      lastError: m.lastError,
    }))
    /*
     * Failures first, then what is scheduled soonest, then what has no slot.
     *
     * A failure is the only row that needs a person, so it goes above a queue that is
     * working. Something with no slot sorts last rather than first: an unscheduled message
     * is not imminent, and sorting null as the earliest time said the opposite.
     */
    .sort((a, b) => {
      const byFailure = Number(b.state === "failed") - Number(a.state === "failed");
      if (byFailure !== 0) return byFailure;
      if (a.goesAt && b.goesAt) return a.goesAt.localeCompare(b.goesAt);
      if (a.goesAt) return -1;
      if (b.goesAt) return 1;
      return a.id.localeCompare(b.id);
    });

  const scheduled = messages
    .filter((m) => m.goesAt && m.state !== "failed")
    .map((m) => m.goesAt!)
    .sort();

  return {
    from: sendingAddress(input.mailbox, input.fromAlias),
    messages,
    waitingOnYou: messages.filter((m) => m.state === "pending_approval").length,
    readyToGo: messages.filter(
      (m) => m.state === "approved" || m.state === "queued" || m.state === "sending",
    ).length,
    failed: messages.filter((m) => m.state === "failed").length,
    nextAt: scheduled[0] ?? null,
  };
}
