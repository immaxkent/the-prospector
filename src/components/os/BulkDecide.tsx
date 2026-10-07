import { useState } from "react";
import { toast } from "sonner";
import type { Prospect } from "@/data/types";
import { bulkTarget } from "@/data/prospect-state";
import { useReleaseProspects, useResolveProspects } from "@/data/mutations";
import { useAppMode } from "@/data/store";
import { Button, MachineLabel } from "./primitives";

const ACTIONS = [
  { id: "release", label: "RELEASE", help: "Cleared for outreach. The agent will draft to these." },
  {
    id: "dequeue",
    label: "DEQUEUE",
    help: "Frees its place in the buffer; no judgement recorded.",
  },
  {
    id: "reject",
    label: "REJECT",
    help: "Wrong prospect, and why. This is what the agent learns from.",
  },
] as const;

type Action = (typeof ACTIONS)[number]["id"];

/**
 * The decisions, taken on several rows at once, from the list itself.
 *
 * These were built in WP-20 and lived only on the endeavour page, which meant the screen
 * where a person actually reads prospects was the one screen that could not act on them —
 * every judgement cost opening the row, deciding, closing it, and finding your place again.
 *
 * Release and the two ways of clearing are different buttons rather than one dropdown: they
 * mean different things to the agent, and a reader who cannot see that will record "never
 * replied" as a rejection reason and teach it nothing.
 */
export function BulkDecide({
  selected,
  onDone,
}: {
  selected: readonly Prospect[];
  onDone: () => void;
}) {
  const mode = useAppMode();
  const release = useReleaseProspects();
  const resolve = useResolveProspects();
  const [action, setAction] = useState<Action>("release");
  const [reason, setReason] = useState("");

  const target = bulkTarget(selected);
  const chosen = ACTIONS.find((a) => a.id === action)!;
  const busy = release.isPending || resolve.isPending;
  const needsReason = action === "reject" && !reason.trim();
  // Releasing something already released, or never scored, is a no-op the operator should
  // see before they press it rather than read about in a toast afterwards.
  const nothingToRelease = action === "release" && target.releasable === 0;

  const done = () => {
    setReason("");
    onDone();
  };

  const submit = () => {
    if (mode === "demo") {
      toast("Demo mode: nothing was saved");
      return;
    }
    const endeavourId = target.endeavourId;
    if (!endeavourId) return;
    const prospectIds = selected.map((p) => p.id);
    if (action === "release") release.mutate({ endeavourId, prospectIds }, { onSuccess: done });
    else
      resolve.mutate(
        {
          endeavourId,
          prospectIds,
          resolution: action,
          reason: action === "reject" ? reason.trim() : null,
        },
        { onSuccess: done },
      );
  };

  return (
    <div
      className="flex flex-wrap items-center gap-2 rounded-[3px] border border-signal bg-signal-soft px-3 py-2.5"
      data-testid="bulk-decide"
    >
      <MachineLabel tone="signal">{selected.length} SELECTED</MachineLabel>

      <div className="flex flex-wrap gap-1">
        {ACTIONS.map((option) => (
          <Button
            key={option.id}
            size="sm"
            variant={action === option.id ? "primary" : "ghost"}
            onClick={() => setAction(option.id)}
          >
            {option.label}
          </Button>
        ))}
      </div>

      {action === "reject" && (
        <input
          aria-label="Why these are being rejected"
          className="h-8 w-[240px] rounded-[3px] border border-border bg-card px-2 text-[12px] outline-none focus:border-signal"
          placeholder="Why these are wrong"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      )}

      <Button
        variant="primary"
        size="sm"
        disabled={busy || !!target.problem || needsReason || nothingToRelease}
        onClick={submit}
      >
        {busy ? "Saving…" : `${chosen.label} ${selected.length}`}
      </Button>

      <Button variant="ghost" size="sm" onClick={onDone}>
        Clear
      </Button>

      <p className="machine w-full text-muted-foreground" data-testid="bulk-help">
        {target.problem ??
          (nothingToRelease
            ? "None of these is waiting on a decision, so there is nothing to release."
            : chosen.help)}
      </p>
    </div>
  );
}
