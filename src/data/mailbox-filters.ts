/**
 * The four ways to look at a mailbox.
 *
 * A thread is not in one state — it holds a conversation, and the same conversation can
 * have a reply sitting in it and a draft waiting on you at once. So these are filters over
 * threads, not a status each thread has, and the counts overlap on purpose: "3 drafts" and
 * "5 replies" can both be true of a mailbox holding five threads.
 */
import type { Thread } from "./types";

export type MailboxFilter = "all" | "drafts" | "sent" | "replies";

export interface MailboxView {
  id: MailboxFilter;
  label: string;
  /** What this view answers, shown when there is nothing in it. */
  empty: string;
}

export const MAILBOX_VIEWS: MailboxView[] = [
  { id: "all", label: "ALL", empty: "No conversations yet." },
  { id: "drafts", label: "DRAFTS", empty: "Nothing is waiting on you." },
  { id: "sent", label: "SENT", empty: "Nothing has gone out yet." },
  { id: "replies", label: "REPLIES", empty: "Nobody has replied yet." },
];

/** A draft is written but not yet sent, so it is the thing still asking for a decision. */
const hasDraft = (t: Thread) => t.messages.some((m) => m.draft && m.sendState !== "sent");
const hasSent = (t: Thread) => t.messages.some((m) => m.sendState === "sent");
const hasReply = (t: Thread) => t.messages.some((m) => m.author === "PROSPECT");

export function matchesFilter(thread: Thread, filter: MailboxFilter): boolean {
  if (filter === "drafts") return hasDraft(thread);
  if (filter === "sent") return hasSent(thread);
  if (filter === "replies") return hasReply(thread);
  return true;
}

export const filterThreads = (threads: readonly Thread[], filter: MailboxFilter) =>
  threads.filter((t) => matchesFilter(t, filter));

/** How many threads each view holds, for the tab row. */
export function mailboxCounts(threads: readonly Thread[]): Record<MailboxFilter, number> {
  return {
    all: threads.length,
    drafts: threads.filter(hasDraft).length,
    sent: threads.filter(hasSent).length,
    replies: threads.filter(hasReply).length,
  };
}

/**
 * The view to open on.
 *
 * Anything waiting on the operator comes first, because that is the only view whose
 * contents they have to act on; then replies, which are new information; then everything.
 */
export function openingFilter(threads: readonly Thread[]): MailboxFilter {
  const counts = mailboxCounts(threads);
  if (counts.drafts > 0) return "drafts";
  if (counts.replies > 0) return "replies";
  return "all";
}
