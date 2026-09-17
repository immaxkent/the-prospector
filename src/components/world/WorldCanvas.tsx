import { Suspense, lazy, useEffect, useState } from "react";

const WorldScene = lazy(() => import("./WorldScene"));

/**
 * Mounts the 3D backdrop only in the browser (the scene must never render on
 * the server). Renders behind every surface; purely presentational.
 */
export function WorldCanvas({ station }: { station: number }) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!reduce) setMounted(true);
  }, []);

  return (
    <div className="pointer-events-none fixed inset-0 z-0 bg-background" aria-hidden="true">
      {mounted && (
        <Suspense fallback={null}>
          <WorldScene station={station} />
        </Suspense>
      )}
      <div className="world-vignette absolute inset-0" />
    </div>
  );
}
