import type { TimelineEntry, TimelineKind } from "@/data/types";
import { MachineLabel } from "./primitives";
import { stamp } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Everything that happened to a prospect, on one tape.
 *
 * It was in four places: research in the evidence table, qualification in the score, what was
 * sent in the mailbox, and what happened off-channel in the interaction log. Four places is
 * four chances to miss the one that mattered — someone already answered on Discord, say —
 * and the decision then gets made on the score alone.
 *
 * Newest first, because the question is almost always "what has happened lately".
 */
const LABEL: Record<TimelineKind, string> = {
  research: "RESEARCH",
  trigger: "TRIGGER",
  qualified: "QUALIFIED",
  released: "RELEASED",
  sent: "SENT",
  failed: "COULD NOT SEND",
  received: "REPLY",
  elsewhere: "ELSEWHERE",
  decision: "DECISION",
};

/** The three that mean a person did something, which is what a reader scans for. */
const EMPHATIC = new Set<TimelineKind>(["received", "released", "decision", "failed"]);

/** A failure is not an event to note, it is one to act on, so it is coloured as a fault. */
const FAULT = new Set<TimelineKind>(["failed"]);

export function Timeline({ entries }: { entries: readonly TimelineEntry[] }) {
  if (entries.length === 0) {
    return (
      <p className="text-[13px] text-muted-foreground" data-testid="timeline-empty">
        Nothing has happened to this one yet.
      </p>
    );
  }

  return (
    <ol className="space-y-3" data-testid="timeline">
      {entries.map((e) => (
        <li
          key={e.id}
          data-testid="timeline-entry"
          data-kind={e.kind}
          className={cn(
            "border-l-2 pl-3",
            FAULT.has(e.kind)
              ? "border-danger bg-surface-2 py-2 pr-2"
              : EMPHATIC.has(e.kind)
                ? "border-signal bg-surface-2 py-2 pr-2"
                : "border-border",
          )}
        >
          <MachineLabel
            tone={FAULT.has(e.kind) ? "danger" : EMPHATIC.has(e.kind) ? "signal" : "muted"}
          >
            {LABEL[e.kind]} · {stamp(e.at)}
          </MachineLabel>
          <p className="mt-1 text-[13px]">{e.title}</p>
          {e.detail && <p className="mt-0.5 text-[12px] text-muted-foreground">{e.detail}</p>}
          {e.url && (
            <a
              href={e.url}
              target="_blank"
              rel="noreferrer"
              className="machine mt-1 inline-block text-muted-foreground underline hover:text-foreground"
            >
              READ THE SOURCE
            </a>
          )}
        </li>
      ))}
    </ol>
  );
}
