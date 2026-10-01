import { useState } from "react";
import { toast } from "sonner";
import type { Endeavour } from "@/data/types";
import { usePinSegmentShare } from "@/data/mutations";
import { useAppMode } from "@/data/store";
import { Button, MachineLabel } from "./primitives";

const inputCls =
  "w-20 rounded-[3px] border border-border bg-card px-2 py-1.5 text-[13px] outline-none focus:border-signal";

/**
 * Where the pending buffer actually went, and the chance to decide it differently.
 *
 * The equal split is a default rather than a judgement: at this volume there is no evidence
 * to divide the buffer any other way. An operator who has read the replies has better
 * evidence than the arithmetic does, so a share can be fixed by hand — the rest is divided
 * between whatever is left.
 */
export function SegmentShares({ endeavour }: { endeavour: Endeavour }) {
  const mode = useAppMode();
  const pin = usePinSegmentShare();
  const [draft, setDraft] = useState<Record<string, string>>({});

  if (endeavour.segments.length === 0) {
    return (
      <p className="px-4 py-4 text-[13px] text-muted-foreground">
        No active segments, so there is nothing to divide. Segments come from the endeavour's buyers.
      </p>
    );
  }

  const archived = endeavour.status === "archived";
  const pinnedTotal = endeavour.segments.reduce((sum, s) => sum + (s.pinnedShare ?? 0), 0);
  const sharing = endeavour.segments.filter((s) => s.pinnedShare === null).length;

  const save = (segmentId: string, share: number | null) => {
    if (mode === "demo") {
      toast("Demo mode: nothing was saved");
      return;
    }
    pin.mutate({ segmentId, share });
  };

  return (
    <div className="space-y-3 px-4 py-4" data-testid="segment-shares">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="text-left">
            <th className="pb-2"><MachineLabel>SEGMENT</MachineLabel></th>
            <th className="pb-2"><MachineLabel>HOLDING</MachineLabel></th>
            <th className="pb-2"><MachineLabel>SHARE</MachineLabel></th>
            <th className="pb-2"><MachineLabel>PINNED</MachineLabel></th>
          </tr>
        </thead>
        <tbody>
          {endeavour.segments.map((segment) => {
            const value = draft[segment.id] ?? (segment.pinnedShare === null ? "" : String(segment.pinnedShare));
            const typed = value.trim();
            const parsed = typed === "" ? null : Number(typed);
            const bad = parsed !== null && (!Number.isInteger(parsed) || parsed < 0);
            return (
              <tr key={segment.id} className="border-t border-border" data-testid={`segment-share-${segment.id}`}>
                <td className="py-2 pr-3">{segment.name}</td>
                <td className="py-2 pr-3 tabular-nums">{segment.pending}</td>
                <td className="py-2 pr-3 tabular-nums">
                  {segment.share}
                  {segment.pending > segment.share && (
                    // Not an error. A lowered cap or a new segment leaves one over its share,
                    // and nothing is deleted to balance it — it just gets nothing new.
                    <span className="ml-2 text-muted-foreground">over, nothing new until these resolve</span>
                  )}
                </td>
                <td className="py-2">
                  <div className="flex items-center gap-2">
                    <input
                      aria-label={`Pinned share for ${segment.name}`}
                      className={inputCls}
                      inputMode="numeric"
                      placeholder="even"
                      value={value}
                      onChange={(e) => setDraft((d) => ({ ...d, [segment.id]: e.target.value }))}
                    />
                    <Button
                      size="sm"
                      disabled={pin.isPending || bad || archived}
                      onClick={() => save(segment.id, parsed)}
                    >
                      {segment.pinnedShare !== null && typed === "" ? "Unpin" : "Pin"}
                    </Button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <p className="text-[13px] text-muted-foreground" data-testid="segment-shares-summary">
        {pinnedTotal > 0 ? (
          <>
            {pinnedTotal} of {endeavour.settings.prospecting.maximumPending} pinned by hand;{" "}
            {sharing === 0 ? "nothing is left for the rest" : `${sharing} segment${sharing === 1 ? "" : "s"} share what is left`}.
          </>
        ) : (
          <>
            Divided evenly. Leave a share blank to keep it that way — the split is a default, not a
            judgement, and at this volume there is not enough evidence to weight it any other way.
          </>
        )}
      </p>
      {archived && <MachineLabel>ARCHIVED: SHARES CANNOT CHANGE</MachineLabel>}
    </div>
  );
}
