import type { Prospect } from "@/data/types";
import { reachOf, type Reach } from "@/data/prospect-state";
import { Tag } from "./primitives";

/**
 * Whether there is anyone to send to, said on the row.
 *
 * A prospect with no route to the company looks exactly like one with a named CTO's address
 * until it is opened, so the highest-scoring rows on the list were sometimes the ones there
 * was nothing to be done about. Research can also only find a generic inbox, which is worth
 * having but converts worse — that difference is worth a glance too.
 *
 * v1 sends email only. A Discord or Telegram handle is a real route, but one the operator
 * opens themselves, and the tag says so rather than implying the agent will.
 */
const LABEL: Record<Reach, string> = {
  named: "NAMED",
  inbox: "INBOX",
  handle: "BY HAND",
  none: "NO ROUTE",
};

const TONE: Record<Reach, "signal" | "neutral" | "warn" | "danger"> = {
  named: "signal",
  inbox: "neutral",
  handle: "warn",
  none: "danger",
};

const TITLE: Record<Reach, string> = {
  named: "A named person's address — the agent can send to this.",
  inbox: "A generic inbox. Usable, but it converts worse than a named person.",
  handle: "Only a handle. You open the conversation; the agent cannot send to it.",
  none: "No route to this company was found. Nothing can be sent until one is added.",
};

export function ReachTag({ contacts }: { contacts: Prospect["contacts"] }) {
  const reach = reachOf(contacts);
  return (
    <span title={TITLE[reach]} data-testid="reach-tag" data-reach={reach}>
      <Tag tone={TONE[reach]}>{LABEL[reach]}</Tag>
    </span>
  );
}
