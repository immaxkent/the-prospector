import { useEffect, useState } from "react";
import type { AgentRun } from "@/data/types";
import { agentClock, ago, until } from "@/data/agent-clock";
import { MachineLabel } from "./primitives";
import { cn } from "@/lib/utils";

const PHASE_WORDS: Record<string, string> = {
  load: "loading the endeavour",
  review_yesterday: "reviewing outstanding work",
  process_inbound: "reading replies",
  recalculate: "recalculating the pipeline",
  research: "researching prospects",
  qualify: "qualifying",
  top_up: "looking again",
  build_queue: "building today's queue",
  draft: "drafting outreach",
  send: "sending approved messages",
  escalate: "checking escalations",
  learn: "learning from replies",
  brief: "writing the daily brief",
  done: "finishing",
};

/**
 * Whether the agent is alive, and when it last was.
 *
 * A system that works unattended has to answer "is it doing anything?" before anything
 * else, and the endeavour page previously answered it by implication — you inferred it
 * from counts that had not moved. The orb says it outright.
 *
 * Four states, and they are genuinely different questions: running now, ran recently,
 * has not run in over a day, has never run. Only the third is a warning; the fourth is a
 * new endeavour, which is not a fault.
 */
export function AgentOrb({ runs }: { runs: readonly AgentRun[] }) {
  // A minute's resolution is all the copy needs, and a tick a second would re-render the
  // page sixty times an hour to change nothing.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const tick = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(tick);
  }, []);

  const clock = agentClock(runs, now);
  const tone =
    clock.pulse === "running" ? "signal" : clock.pulse === "stalled" ? "warn" : clock.lastFailed ? "warn" : "idle";

  return (
    <div className="flex items-center gap-3" data-testid="agent-orb">
      <span className="relative flex h-7 w-7 shrink-0 items-center justify-center">
        {/* The halo only exists while something is happening: a permanent animation stops
            being a signal and becomes decoration. */}
        {clock.pulse === "running" && (
          <span aria-hidden="true" className="agent-orb-halo absolute inset-0 rounded-full bg-signal/25" />
        )}
        <span
          aria-hidden="true"
          className={cn(
            "relative h-2.5 w-2.5 rounded-full",
            tone === "signal" && "agent-orb-live bg-signal",
            tone === "warn" && "bg-warn",
            tone === "idle" && "bg-foreground/35",
          )}
        />
      </span>

      <div className="min-w-0">
        <MachineLabel className={cn(tone === "warn" && "text-warn")}>
          {clock.pulse === "running"
            ? `RUNNING · ${PHASE_WORDS[clock.phase ?? ""] ?? clock.phase ?? "working"}`
            : clock.pulse === "never"
              ? "NEVER RUN"
              : clock.pulse === "stalled"
                ? "NOT RUN IN OVER A DAY"
                : clock.lastFailed
                  ? "LAST RUN FAILED"
                  : "IDLE"}
        </MachineLabel>
        <p className="machine mt-0.5 text-foreground/40">
          {clock.lastRunAt ? `LAST ${ago(clock.lastRunAt, now)}` : "NOTHING YET"} · NEXT{" "}
          {until(clock.nextDueAt, now)}
        </p>
      </div>
    </div>
  );
}
