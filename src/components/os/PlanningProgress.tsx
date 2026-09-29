import { useEffect, useState } from "react";
import { planProgressFn } from "@/api/intake";
import { Button, MachineLabel } from "./primitives";

/**
 * What the planner is doing, while it does it.
 *
 * The four passes are real — they are how `PLANNER_PASSES` is shaped — and the server
 * reports each one as it lands, so the fraction shown is counted rather than guessed.
 *
 * What is still absent is *which* pass finished. They run under one Promise.all and arrive
 * in any order, so the bar says how many have come back and the list says what is being
 * worked on, and neither claims to pair them up.
 */
const PASSES = [
  "the objective, horizon and cadence",
  "what you sell and what it costs",
  "what outreach can point to",
  "who buys it, and who you will not work with",
];

/** What a planning call has taken in practice. Used to say when one is running long. */
const TYPICAL_SECONDS = 60;

/** Four arrivals over about a minute: often enough to feel live, rare enough to be free. */
const POLL_MS = 900;

export function PlanningProgress({ planId, onStop }: { planId: string; onStop: () => void }) {
  const [seconds, setSeconds] = useState(0);
  const [done, setDone] = useState(0);

  useEffect(() => {
    const tick = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(tick);
  }, []);

  useEffect(() => {
    let live = true;
    const ask = async () => {
      try {
        const result = await planProgressFn({ data: { planId } });
        // Only ever forward: a poll that lands after the call has ended finds nothing, and
        // dropping back to zero at the finish would read as a failure.
        if (live && result.done > 0) setDone((was) => Math.max(was, result.done));
      } catch {
        // A failed poll is not worth reporting; the next one will do, and the call itself
        // reports its own failure.
      }
    };
    const poll = setInterval(ask, POLL_MS);
    void ask();
    return () => {
      live = false;
      clearInterval(poll);
    };
  }, [planId]);

  const slow = seconds > TYPICAL_SECONDS;

  return (
    <div className="space-y-3 rounded-[8px] border border-signal/30 px-4 py-4" data-testid="planning-progress">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span aria-hidden="true" className="planning-pulse h-2 w-2 rounded-full bg-signal" />
          <MachineLabel>
            {done === 0 ? "READING YOUR BRIEF" : `${done} OF ${PASSES.length} DONE`} · {seconds}s
          </MachineLabel>
        </div>
        <Button variant="destructive" size="sm" onClick={onStop}>
          Stop planning
        </Button>
      </div>

      {/*
        Indeterminate until a pass lands, then a real fraction. The passes run together, so
        the bar reports how many have arrived — never which, because there is no order.
      */}
      <div className="h-[3px] w-full overflow-hidden rounded-full bg-white/[0.06]">
        {done === 0 ? (
          <div className="planning-bar h-full w-1/3 rounded-full bg-signal/70" />
        ) : (
          <div
            className="h-full rounded-full bg-signal/70 transition-[width] duration-500 ease-out"
            style={{ width: `${(done / PASSES.length) * 100}%` }}
          />
        )}
      </div>

      {/*
        No tick beside any one pass. They finish in whatever order they finish, so marking
        the first N would be claiming to know which — and the reader has no way to tell
        that apart from knowing. The count is true; the attribution would not be.
      */}
      <ul className="space-y-0.5">
        {PASSES.map((pass) => (
          <li key={pass} className="machine text-foreground/45">
            · {pass}
          </li>
        ))}
      </ul>

      <p className="text-[12px] text-muted-foreground">
        {slow
          ? "Longer than usual. Web search can be slow; stopping and starting again is safe."
          : "Usually under a minute. Stopping leaves your brief as you wrote it, ready to edit."}
      </p>
    </div>
  );
}
