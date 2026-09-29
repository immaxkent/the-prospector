import { useEffect, useState } from "react";
import { Button, MachineLabel } from "./primitives";

/**
 * What the planner is doing, while it does it.
 *
 * The four passes are real — they are how `PLANNER_PASSES` is shaped, and they run at once
 * rather than in order. What is deliberately absent is a percentage: the call returns in
 * one piece and nothing reports progress from inside it, so a bar that filled would be
 * inventing a number. Elapsed time is the one honest measure available, so that is what is
 * shown.
 */
const PASSES = [
  "the objective, horizon and cadence",
  "what you sell and what it costs",
  "what outreach can point to",
  "who buys it, and who you will not work with",
];

/** What a planning call has taken in practice. Used to say when one is running long. */
const TYPICAL_SECONDS = 60;

export function PlanningProgress({ onStop }: { onStop: () => void }) {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const tick = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(tick);
  }, []);

  const slow = seconds > TYPICAL_SECONDS;

  return (
    <div className="space-y-3 rounded-[8px] border border-signal/30 px-4 py-4" data-testid="planning-progress">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span aria-hidden="true" className="planning-pulse h-2 w-2 rounded-full bg-signal" />
          <MachineLabel>READING YOUR BRIEF · {seconds}s</MachineLabel>
        </div>
        <Button variant="destructive" size="sm" onClick={onStop}>
          Stop planning
        </Button>
      </div>

      {/* Indeterminate on purpose: the passes run together, and none of them reports back. */}
      <div className="planning-track h-[3px] w-full overflow-hidden rounded-full bg-white/[0.06]">
        <div className="planning-bar h-full w-1/3 rounded-full bg-signal/70" />
      </div>

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
