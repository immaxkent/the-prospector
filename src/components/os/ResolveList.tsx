import { useState } from "react";
import { toast } from "sonner";
import type { Prospect } from "@/data/types";
import { useResolveProspects } from "@/data/mutations";
import { useAppMode } from "@/data/store";
import { Button, MachineLabel } from "./primitives";
import { cn } from "@/lib/utils";

const inputCls =
  "w-full rounded-[3px] border border-border bg-card px-2 py-1.5 text-[12px] outline-none focus:border-signal";

const RESOLUTIONS = [
  { id: "dequeue", label: "DEQUEUE", help: "Went nowhere for now. Frees its place in the buffer; no judgement recorded." },
  { id: "reject", label: "REJECT", help: "Wrong prospect, and why. This is what the agent learns from." },
  { id: "won", label: "MARK WON", help: "Closed. Counts towards the objective." },
  { id: "lost", label: "MARK LOST", help: "Closed, and not won." },
] as const;

type Resolution = (typeof RESOLUTIONS)[number]["id"];

/**
 * Clearing things out of the buffer, several at a time.
 *
 * Nothing leaves the buffer on its own — a prospect that never answered stays put until a
 * person says otherwise. That only holds if saying otherwise is cheap: an operator who
 * finds it tedious stops doing it, the buffer fills, and prospecting stops for good.
 *
 * Dequeue and reject are deliberately different buttons rather than one with a dropdown.
 * They mean different things to the agent, and a reader who cannot see that from the screen
 * will record "never replied" as a rejection reason and teach it nothing.
 */
export function ResolveList({
  endeavourId,
  prospects,
  emptyNote,
}: {
  endeavourId: string;
  prospects: readonly Prospect[];
  emptyNote: string;
}) {
  const mode = useAppMode();
  const resolve = useResolveProspects();
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [resolution, setResolution] = useState<Resolution>("dequeue");
  const [reason, setReason] = useState("");

  if (prospects.length === 0) {
    return <p className="px-4 py-4 text-[13px] text-muted-foreground">{emptyNote}</p>;
  }

  const toggle = (id: string) =>
    setTicked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const chosen = RESOLUTIONS.find((r) => r.id === resolution)!;
  const needsReason = resolution === "reject" && !reason.trim();

  return (
    <div data-testid="resolve-list">
      <ul className="divide-y divide-border">
        {prospects.map((prospect) => (
          <li key={prospect.id} className="flex items-center gap-3 px-4 py-2.5">
            <input
              aria-label={`Select ${prospect.company}`}
              type="checkbox"
              checked={ticked.has(prospect.id)}
              onChange={() => toggle(prospect.id)}
            />
            <span className="min-w-0 flex-1 text-[13px]">
              {prospect.company}
              <span className="machine ml-2 text-muted-foreground">{prospect.status}</span>
            </span>
          </li>
        ))}
      </ul>

      <div
        className={cn(
          "flex flex-wrap items-center gap-2 border-t border-border px-4 py-3",
          ticked.size === 0 && "opacity-50",
        )}
        data-testid="resolve-bar"
      >
        <div className="flex flex-wrap gap-1">
          {RESOLUTIONS.map((option) => (
            <Button
              key={option.id}
              size="sm"
              variant={resolution === option.id ? "primary" : "ghost"}
              onClick={() => setResolution(option.id)}
            >
              {option.label}
            </Button>
          ))}
        </div>

        {resolution === "reject" && (
          <input
            aria-label="Why these are being rejected"
            className={`${inputCls} max-w-xs`}
            placeholder="Why these are wrong"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        )}

        <Button
          variant="primary"
          size="sm"
          disabled={ticked.size === 0 || needsReason || resolve.isPending}
          onClick={() => {
            if (mode === "demo") {
              toast("Demo mode: nothing was saved");
              return;
            }
            resolve.mutate(
              {
                endeavourId,
                prospectIds: [...ticked],
                resolution,
                reason: resolution === "reject" ? reason.trim() : null,
              },
              { onSuccess: () => { setTicked(new Set()); setReason(""); } },
            );
          }}
        >
          {resolve.isPending ? "Saving…" : `${chosen.label} ${ticked.size || ""}`.trim()}
        </Button>

        <p className="machine w-full text-muted-foreground" data-testid="resolve-help">
          {chosen.help}
        </p>
      </div>
    </div>
  );
}
