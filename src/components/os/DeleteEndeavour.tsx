import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import type { Endeavour } from "@/data/types";
import { usePurgeEndeavour } from "@/data/mutations";
import { useAppMode } from "@/data/store";
import { Button, MachineLabel } from "./primitives";

/**
 * Deleting an endeavour for good.
 *
 * Archiving is the ordinary end of an endeavour and is one click away; this is for
 * starting again, and it destroys the prospects, threads, approvals and evidence with it.
 * There is no backup to restore from, so the name has to be typed rather than a second
 * button pressed — a confirm dialog only asks whether you meant to click, and the answer
 * to that is almost always yes.
 *
 * It lives at the foot of CONFIGURATION rather than beside Pause and Archive, because a
 * destructive action next to a routine one gets pressed by accident eventually.
 */
export function DeleteEndeavour({ endeavour }: { endeavour: Endeavour }) {
  const mode = useAppMode();
  const navigate = useNavigate();
  const purge = usePurgeEndeavour();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");

  const active = endeavour.status === "active";
  const matches = typed.trim().toLowerCase() === endeavour.name.trim().toLowerCase();

  if (!open) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="destructive" size="sm" onClick={() => setOpen(true)}>
          Delete this endeavour
        </Button>
        <MachineLabel className="text-muted-foreground">
          REMOVES ITS PROSPECTS, THREADS, APPROVALS AND EVIDENCE · CANNOT BE UNDONE
        </MachineLabel>
      </div>
    );
  }

  return (
    <div className="space-y-2.5 rounded-[8px] border border-danger/40 px-3 py-3" data-testid="delete-endeavour">
      <p className="text-[13px]">
        This deletes <span className="font-medium">{endeavour.name}</span> and everything under it: every prospect,
        thread, message, approval and piece of evidence. Companies no other endeavour is using go too. There is no
        backup.
      </p>

      {active ? (
        // Pausing first is one deliberate act before another, and an active endeavour is
        // one the worker may be running this minute.
        <p className="text-[13px] text-warn">Pause or archive it first — it is still active.</p>
      ) : (
        <label className="block space-y-1.5">
          <MachineLabel>TYPE ITS NAME TO CONFIRM</MachineLabel>
          <input
            aria-label="Endeavour name to confirm deletion"
            className="w-full max-w-[420px] rounded-[3px] border border-border bg-card px-2.5 py-2 text-[13px] outline-none focus:border-danger"
            placeholder={endeavour.name}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
          />
        </label>
      )}

      {/* Always reachable. Opening this on an active endeavour used to leave no way out,
          because the only cancel sat inside the branch that asks for the name. */}
      <div className="flex items-center gap-3">
        {!active && (
          <Button
            variant="destructive"
            size="sm"
            disabled={!matches || purge.isPending}
            onClick={() => {
              if (mode === "demo") {
                toast("Demo mode: nothing was saved");
                return;
              }
              purge.mutate(
                { endeavourId: endeavour.id, confirmName: typed.trim() },
                { onSuccess: () => void navigate({ to: "/endeavours" }) },
              );
            }}
          >
            {purge.isPending ? "Deleting…" : "Delete for good"}
          </Button>
        )}
        <button
          type="button"
          className="machine text-muted-foreground hover:text-foreground"
          onClick={() => {
            setOpen(false);
            setTyped("");
          }}
        >
          CANCEL
        </button>
      </div>
    </div>
  );
}
