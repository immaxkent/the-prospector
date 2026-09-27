/**
 * The addresses an endeavour can send from.
 *
 * A mailbox is an account; an endeavour sends from an address. Those are not the same
 * thing, because an account may also send as its aliases. Offering only the accounts made
 * an alias look unavailable at the moment it mattered most — when the endeavour was
 * created — so both are offered together, as one list of addresses.
 */
import type { Mailbox } from "./types";

export interface SendingAddress {
  /** Stable value for a <select> option. Mailbox ids never contain the separator. */
  key: string;
  mailboxId: string;
  address: string;
  /** null when this is the account's own address. */
  alias: string | null;
  /** What the operator reads in the list. */
  label: string;
}

const SEP = "::";

/**
 * Every address the connected mailboxes can send from: each account, then its aliases.
 *
 * An alias is labelled with the account behind it, because Google counts its sends
 * against that account's daily cap — choosing one is not a way to send more.
 */
export function sendingAddresses(mailboxes: readonly Mailbox[]): SendingAddress[] {
  return mailboxes
    .filter((m) => m.status === "connected")
    .flatMap((m) => [
      { key: m.id, mailboxId: m.id, address: m.address, alias: null, label: m.address },
      ...m.aliases.map((a) => ({
        key: `${m.id}${SEP}${a.address}`,
        mailboxId: m.id,
        address: a.address,
        alias: a.address,
        label: `${a.address} — via ${m.address}`,
      })),
    ]);
}

/** Reads back what a <select> holds. Returns null for the empty "choose one" option. */
export function parseSendingAddress(key: string): { mailboxId: string; alias: string | null } | null {
  if (!key) return null;
  const at = key.indexOf(SEP);
  return at === -1
    ? { mailboxId: key, alias: null }
    : { mailboxId: key.slice(0, at), alias: key.slice(at + SEP.length) };
}

/**
 * The option matching what is stored. An alias that no longer exists falls back to its
 * account rather than to nothing, so the list never looks empty for a mailbox that is
 * still perfectly able to send.
 */
export function sendingAddressKey(
  options: readonly SendingAddress[],
  mailboxId: string | null | undefined,
  alias: string | null | undefined,
): string {
  if (!mailboxId) return "";
  const wanted = alias?.trim().toLowerCase();
  if (wanted) {
    const match = options.find((o) => o.mailboxId === mailboxId && o.alias?.toLowerCase() === wanted);
    if (match) return match.key;
  }
  return options.some((o) => o.key === mailboxId) ? mailboxId : "";
}
