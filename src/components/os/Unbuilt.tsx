import type { ReactNode } from "react";
import { MachineLabel } from "./primitives";

/**
 * A stage that exists in the plan and not yet in the product.
 *
 * Shown rather than hidden, because the order of the stages is itself information: an
 * operator who can see that REACH comes between IDENTIFY and OUTREACH understands the shape
 * of the work even before that stage does anything.
 *
 * But shown *marked*. A half-built panel with no label is worse than no panel at all —
 * nothing on the screen distinguishes a feature that is broken from one that has not been
 * written, and the reader is left to work out which by poking at it.
 *
 * So: dimmed, labelled, and inert. Nothing inside can be clicked, because an action that
 * silently does nothing teaches the operator to distrust the ones that work.
 */
export function Unbuilt({ what, children }: { what: string; children?: ReactNode }) {
  return (
    <div
      data-testid="unbuilt"
      data-unbuilt="true"
      className="relative rounded-[10px] border border-dashed border-border px-4 py-4"
    >
      <MachineLabel className="text-foreground/40">NOT BUILT YET</MachineLabel>
      <p className="mt-1 text-[13px] text-muted-foreground">{what}</p>
      {children && (
        // aria-hidden as well as inert: a screen reader should not read out a preview as
        // though it were the thing itself.
        <div aria-hidden="true" className="pointer-events-none mt-3 select-none opacity-40">
          {children}
        </div>
      )}
    </div>
  );
}
