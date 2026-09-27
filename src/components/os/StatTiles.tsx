import type { StatContext, StatTile } from "@/data/stat-tiles";
import { cn } from "@/lib/utils";

/**
 * The row of headline numbers an endeavour opens with.
 *
 * These are meant to be read from across the room and then not read again, so the number
 * is the whole tile and everything else is small: the label above it, what it is out of
 * below. A tile with nothing to show yet says so in words rather than showing a zero that
 * would be mistaken for a measurement.
 */
export function StatTiles({ tiles, ctx }: { tiles: readonly StatTile[]; ctx: StatContext }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="stat-tiles">
      {tiles.map((tile) => {
        const stat = tile.compute(ctx);
        const empty = stat.display === null;
        return (
          <div
            key={tile.id}
            data-testid={`stat-tile-${tile.id}`}
            className={cn(
              "stat-tile group relative overflow-hidden rounded-[14px] border px-4 py-4",
              stat.tone === "good" && "stat-tile-good",
              stat.tone === "warn" && "stat-tile-warn",
            )}
          >
            <p className="machine relative text-[9px] text-foreground/45">{tile.label.toUpperCase()}</p>
            <p
              className={cn(
                "stat-tile-value relative mt-2 tabular-nums",
                // An explanation has to be read, so it is set at reading size, not at the
                // size of a number meant to be taken in at a glance.
                empty ? "text-[15px] font-medium text-foreground/40" : "text-[38px] leading-none",
              )}
            >
              {stat.display ?? (stat.sub ?? "nothing yet")}
            </p>
            {!empty && stat.sub && <p className="machine relative mt-2 text-[9px] text-foreground/40">{stat.sub}</p>}
          </div>
        );
      })}
    </div>
  );
}
