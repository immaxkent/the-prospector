import type { CSSProperties } from "react";

/**
 * The backdrop behind every surface: a faint gold grid on near-black, masked to a soft
 * pool under the content.
 *
 * It is plain CSS — no canvas, no WebGL, nothing to mount or tear down — so it is there on
 * the first paint, costs nothing on a small machine, and needs no reduced-motion escape
 * hatch. The station the shell is on shifts the grid slightly, which is all the sense of
 * place a backdrop has to carry.
 */
export function WorldCanvas({ station }: { station: number }) {
  return (
    <div className="pointer-events-none fixed inset-0 z-0 bg-background" aria-hidden="true">
      <div
        className="world-grid absolute inset-0"
        // A fraction of a cell per station, so moving between them reads as movement
        // across one surface rather than as a different backdrop each time.
        style={{ "--station-shift": `${station * 11}px` } as CSSProperties}
      />
      <div className="world-vignette absolute inset-0" />
    </div>
  );
}
