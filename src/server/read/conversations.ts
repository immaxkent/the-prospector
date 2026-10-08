import type { Message, Thread, UnattributedReply } from "@/data/types";
import { iso, type ApprovalRow, type MessageRow, type ThreadRow } from "./rows";

const DRAFT_STATES = new Set(["drafted", "pending_approval", "approved", "rejected"]);

export function buildMessage(m: MessageRow): Message {
  const inbound = m.direction === "inbound";
  return {
    id: m.id,
    threadId: m.threadId,
    author: inbound ? "PROSPECT" : "AGENT",
    draft: !inbound && DRAFT_STATES.has(m.sendState ?? ""),
    sendState: inbound ? null : m.sendState,
    sentAt: iso(inbound ? m.receivedAt : (m.sentAt ?? m.createdAt)),
    body: m.body,
  };
}

function objectionsOf(m: MessageRow): string[] {
  const raw = m.classification?.["objections"];
  return Array.isArray(raw) ? raw.filter((o): o is string => typeof o === "string") : [];
}

/** Only mapped threads belong to an endeavour's inbox. Unmapped threads surface as review approvals instead. */
export function buildThread(thread: ThreadRow, messages: readonly MessageRow[], approvals: readonly ApprovalRow[]): Thread | null {
  if (thread.mappingState !== "mapped" || !thread.endeavourId || !thread.prospectId) return null;
  const own = messages
    .filter((m) => m.threadId === thread.id && m.sendState !== "rejected")
    .sort((a, b) => (a.sentAt ?? a.receivedAt ?? a.createdAt).getTime() - (b.sentAt ?? b.receivedAt ?? b.createdAt).getTime());
  const reply = approvals.find(
    (a) => a.status === "pending" && a.kind === "reply_approval" && a.subjectType === "thread" && a.subjectId === thread.id,
  );
  const draft = reply?.payload["draft"];
  return {
    id: thread.id,
    endeavourId: thread.endeavourId,
    prospectId: thread.prospectId,
    subject: thread.subject,
    channel: "EMAIL",
    unread: thread.unread,
    lastActivityAt: iso(thread.lastActivityAt),
    intent: thread.intent ?? "Not classified",
    objections: [...new Set(own.filter((m) => m.direction === "inbound").flatMap(objectionsOf))],
    suggestedResponse: typeof draft === "string" ? draft : "",
    messages: own.map(buildMessage),
  };
}

/**
 * The replies that could not be placed.
 *
 * `buildThread` returns null for anything unmapped, so these were dropped from the read
 * model entirely: the thread exists, the mail is stored, an approval is raised — and the
 * inbox showed nothing, which makes "nothing came in" and "four arrived that we could not
 * place" look the same.
 *
 * The sender and preview come off the approval where there is one and off the message
 * otherwise, because a thread with no endeavour never got an approval and is exactly the
 * case that was invisible.
 */
export function buildUnattributed(
  threads: readonly ThreadRow[],
  messages: readonly MessageRow[],
  approvals: readonly ApprovalRow[],
): UnattributedReply[] {
  const text = (payload: Record<string, unknown>, key: string) =>
    typeof payload[key] === "string" ? (payload[key] as string) : null;

  return threads
    .filter((t) => t.mappingState === "needs_review")
    .map((t): UnattributedReply => {
      const approval = approvals.find(
        (a) => a.status === "pending" && a.kind === "thread_mapping" && a.subjectId === t.id,
      );
      const inbound = messages
        .filter((m) => m.threadId === t.id && m.direction === "inbound")
        .sort((a, b) => (b.receivedAt ?? b.createdAt).getTime() - (a.receivedAt ?? a.createdAt).getTime())[0];
      const payload = approval?.payload ?? {};
      return {
        id: t.id,
        subject: t.subject,
        from: text(payload, "from") ?? "unknown sender",
        preview: text(payload, "preview") ?? inbound?.body.slice(0, 400) ?? "",
        receivedAt: iso(inbound?.receivedAt ?? t.lastActivityAt),
        guessedProspectId: t.prospectId ?? text(payload, "guessedProspectId"),
        guessedBy: text(payload, "guessedBy") ?? inbound?.attributedBy ?? null,
      };
    })
    .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt) || a.id.localeCompare(b.id));
}
