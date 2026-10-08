import { Link } from "@tanstack/react-router";
import type { OutboundQueue } from "@/data/types";
import { MachineLabel, Panel, Tag } from "./primitives";
import { stamp } from "@/lib/format";
import { until } from "@/data/agent-clock";

/**
 * What is about to go out, and from which address.
 *
 * Approving a draft was the last the operator saw of it. Between approval and arrival a
 * message passes through a pacing queue, a quiet-hours window and a daily cap — so "I
 * approved eight this morning" and "two have gone" both looked normal, and a mailbox that
 * had stopped sending looked exactly like one pacing itself properly.
 *
 * The three counts are kept apart because they need different things: one waits on a person,
 * one waits on the clock, and one is broken.
 */
const STATE_LABEL: Record<string, string> = {
  pending_approval: "WAITING ON YOU",
  approved: "APPROVED",
  queued: "QUEUED",
  sending: "SENDING",
  failed: "FAILED",
};

export function OutboundQueuePanel({ queue, now }: { queue: OutboundQueue; now: Date }) {
  return (
    <Panel
      title="QUEUE"
      meta={
        <MachineLabel>
          {queue.from ? `FROM ${queue.from}` : "NO SENDING MAILBOX"}
          {queue.nextAt ? ` · NEXT ${until(new Date(queue.nextAt), now)}` : ""}
        </MachineLabel>
      }
      bodyClassName="px-4 py-4"
    >
      <div className="flex flex-wrap gap-2" data-testid="queue-counts">
        <Tag tone={queue.waitingOnYou > 0 ? "signal" : "neutral"}>
          {queue.waitingOnYou} WAITING ON YOU
        </Tag>
        <Tag>{queue.readyToGo} READY TO GO</Tag>
        <Tag tone={queue.failed > 0 ? "danger" : "neutral"}>{queue.failed} FAILED</Tag>
      </div>

      {queue.messages.length === 0 ? (
        <p className="mt-3 text-[13px] text-muted-foreground" data-testid="queue-empty">
          Nothing is waiting to go out.
        </p>
      ) : (
        <ul className="hairline-y mt-3" data-testid="queue-list">
          {queue.messages.map((m) => (
            <li key={m.id} className="py-2" data-testid="queue-row" data-state={m.state}>
              <div className="flex flex-wrap items-center gap-2">
                <Tag
                  tone={
                    m.state === "failed"
                      ? "danger"
                      : m.state === "pending_approval"
                        ? "signal"
                        : "neutral"
                  }
                >
                  {STATE_LABEL[m.state] ?? m.state}
                </Tag>
                {m.prospectId ? (
                  <Link
                    to="/prospects/$id"
                    params={{ id: m.prospectId }}
                    className="text-[13px] underline hover:text-signal"
                  >
                    {m.who}
                  </Link>
                ) : (
                  <span className="text-[13px]">{m.who}</span>
                )}
                <span className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground">
                  {m.subject}
                </span>
                {m.state === "pending_approval" && (
                  /*
                   * The drafts are read and approved in NEXT ACTIONS & APPROVALS on this same
                   * page — WP-22 put "what needs you" on the overview on purpose, and showing
                   * the same tickets twice would give two places to approve the same thing.
                   * So this points at the one place rather than becoming a second one.
                   */
                  <a href="#overview" className="machine text-signal underline">
                    REVIEW IT
                  </a>
                )}
                <MachineLabel>
                  {m.state === "failed"
                    ? `${m.attempts} ATTEMPT${m.attempts === 1 ? "" : "S"}`
                    : m.goesAt
                      ? `GOES ${until(new Date(m.goesAt), now)} · ${stamp(m.goesAt)}`
                      : "NO SLOT YET"}
                </MachineLabel>
              </div>
              {m.lastError && (
                <p className="mt-1 text-[12px] text-danger" data-testid="queue-error">
                  {m.lastError}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
