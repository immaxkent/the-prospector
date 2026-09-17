import type { Message, Thread } from "@/data/types";
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
