import { useState } from "react";
import { toast } from "sonner";
import { STAT_TILES, STAT_TILE_COUNT, resolveStatTiles } from "@/data/stat-tiles";
import { useUpdateStatTiles } from "@/data/mutations";
import { useAppMode, useDataset } from "@/data/store";
import { Button, MachineLabel } from "./primitives";
import { cn } from "@/lib/utils";

const GROUPS = [
  { id: "outcome", label: "OUTCOME", hint: "What the endeavour is for." },
  { id: "activity", label: "ACTIVITY", hint: "What it did today." },
  { id: "efficiency", label: "EFFICIENCY", hint: "What that cost, and whether it is working." },
  { id: "clock", label: "THE CLOCK", hint: "How much time is left, and what has to land in it." },
] as const;

/**
 * Chooses the four numbers the endeavour page leads with.
 *
 * Picking is ordered, not a set: the first thing chosen sits first on the row, because
 * where a number sits is most of how quickly it is read. Choosing a fifth is refused
 * rather than silently dropping the oldest — the operator should decide what leaves.
 */
export function StatTilePicker() {
  const mode = useAppMode();
  const { status } = useDataset();
  const save = useUpdateStatTiles();
  const saved = resolveStatTiles(status.statTiles).map((t) => t.id);
  const [picked, setPicked] = useState<string[]>(saved);

  const full = picked.length >= STAT_TILE_COUNT;
  const changed = picked.length !== saved.length || picked.some((id, i) => id !== saved[i]);

  const toggle = (id: string) => {
    if (picked.includes(id)) {
      setPicked(picked.filter((p) => p !== id));
      return;
    }
    if (full) {
      toast(`The row holds ${STAT_TILE_COUNT}. Take one off first.`);
      return;
    }
    setPicked([...picked, id]);
  };

  return (
    <div className="space-y-4 px-4 py-4" data-testid="stat-tile-picker">
      <div className="space-y-1.5">
        <MachineLabel>
          {picked.length} OF {STAT_TILE_COUNT} CHOSEN · SHOWN IN THE ORDER YOU PICK THEM
        </MachineLabel>
        <div className="flex flex-wrap gap-1.5">
          {picked.map((id, i) => (
            <button
              key={id}
              type="button"
              onClick={() => toggle(id)}
              className="machine rounded-full border border-signal/40 bg-signal/5 px-2.5 py-1 text-signal hover:border-signal"
            >
              {i + 1} · {STAT_TILES.find((t) => t.id === id)!.label.toUpperCase()} ✕
            </button>
          ))}
          {picked.length === 0 && <MachineLabel className="text-warn">NONE — THE DEFAULTS WILL BE SHOWN</MachineLabel>}
        </div>
      </div>

      {GROUPS.map((group) => (
        <div key={group.id} className="space-y-1.5">
          <MachineLabel>
            {group.label} · {group.hint}
          </MachineLabel>
          <div className="grid grid-cols-1 gap-1.5 md:grid-cols-2">
            {STAT_TILES.filter((t) => t.group === group.id).map((tile) => {
              const on = picked.includes(tile.id);
              return (
                <button
                  key={tile.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggle(tile.id)}
                  className={cn(
                    "rounded-[6px] border px-3 py-2 text-left transition-colors",
                    on ? "border-signal/50 bg-signal/5" : "border-border bg-card hover:border-foreground/25",
                    // Nothing is disabled: a full row still lets you read what you did not pick.
                    !on && full && "opacity-55",
                  )}
                >
                  <span className="block text-[13px] font-medium">{tile.label}</span>
                  <span className="mt-0.5 block text-[12px] text-muted-foreground">{tile.hint}</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}

      <div className="flex items-center gap-3">
        <Button
          variant="primary"
          size="sm"
          disabled={!changed || save.isPending}
          onClick={() => {
            if (mode === "demo") {
              toast("Demo mode: nothing was saved");
              return;
            }
            save.mutate({ tiles: picked });
          }}
        >
          {save.isPending ? "Saving…" : "Save the row"}
        </Button>
        {changed && (
          <button type="button" className="machine text-muted-foreground hover:text-foreground" onClick={() => setPicked(saved)}>
            DISCARD
          </button>
        )}
      </div>
    </div>
  );
}
