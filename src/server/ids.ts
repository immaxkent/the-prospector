import { randomBytes } from "node:crypto";

export const ID_PREFIXES = {
  endeavour: "end",
  specVersion: "spv",
  user: "usr",
  session: "ses",
  intake: "int",
  mailbox: "mbx",
  segment: "seg",
  offer: "off",
  company: "com",
  person: "per",
  prospect: "pro",
  evidence: "ev",
  trigger: "trg",
  thread: "thr",
  message: "msg",
  activity: "act",
  opportunity: "opp",
  approval: "apr",
  suppression: "sup",
  experiment: "exp",
  insight: "ins",
  run: "run",
  runLog: "log",
  job: "job",
  llmCall: "llm",
  event: "evt",
  notification: "ntf",
  notificationChannel: "nch",
} as const;

export type IdKind = keyof typeof ID_PREFIXES;

const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";

/**
 * Prefixed, time-sortable ids: `pro_` + 10 chars of millisecond time + 12 random chars.
 * Sorting ids by string sorts them by creation time.
 */
export function newId(kind: IdKind, now = Date.now()) {
  let time = "";
  let t = now;
  for (let i = 0; i < 10; i++) {
    time = ALPHABET[t % 32] + time;
    t = Math.floor(t / 32);
  }
  const bytes = randomBytes(12);
  let rand = "";
  for (const b of bytes) rand += ALPHABET[b % 32];
  return `${ID_PREFIXES[kind]}_${time}${rand}`;
}
