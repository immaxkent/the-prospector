import type { Mailbox } from "@/data/types";
import { effectiveDailyCap } from "../domain/mailbox";
import { localDate, sameLocalDay, type EndeavourRow, type MailboxRow, type MessageRow, type ThreadRow } from "./rows";

const hour = (h: number) => `${String(h).padStart(2, "0")}:00`;

export function buildMailbox(
  m: MailboxRow,
  endeavours: readonly EndeavourRow[],
  threads: ReadonlyMap<string, ThreadRow>,
  messages: readonly MessageRow[],
  now: Date,
  /** Whether this connection holds the consent to create addresses. The token itself never leaves the server. */
  canCreateAliases?: boolean,
): Mailbox {
  const today = localDate(now, m.limits.timezone);
  const capToday = effectiveDailyCap(m.limits, today);
  const sentToday = messages.filter(
    (msg) =>
      msg.direction === "outbound" &&
      msg.sendState === "sent" &&
      threads.get(msg.threadId)?.mailboxId === m.id &&
      sameLocalDay(msg.sentAt, now, m.limits.timezone),
  ).length;
  return {
    id: m.id,
    address: m.address,
    displayName: m.displayName,
    provider: m.provider,
    status: m.status,
    dailyCap: m.limits.dailyCap,
    capToday,
    sentToday,
    warmingUp: capToday < m.limits.dailyCap,
    quietHours: `${hour(m.limits.quietHours.start)} – ${hour(m.limits.quietHours.end)}`,
    limits: m.limits,
    endeavourIds: endeavours.filter((e) => e.mailboxId === m.id && e.status !== "archived").map((e) => e.id),
    aliases: m.aliases.map((a) => ({ address: a.address, displayName: a.displayName })),
    canCreateAliases: canCreateAliases ?? false,
  };
}
