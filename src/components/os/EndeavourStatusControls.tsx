import { useState } from "react";
import { toast } from "sonner";
import type { Endeavour } from "@/data/types";
import { useAppMode } from "@/data/store";
import { useSetEndeavourStatus } from "@/data/mutations";
import { Button } from "./primitives";

/** Pause, resume and archive. Archiving asks for confirmation because it cannot be undone. */
export function EndeavourStatusControls({ endeavour }: { endeavour: Endeavour }) {
  const mode = useAppMode();
  const setStatus = useSetEndeavourStatus();
  const [confirmArchive, setConfirmArchive] = useState(false);
  const busy = setStatus.isPending;

  const run = (status: "active" | "paused" | "archived") => {
    if (mode === "demo") {
      toast("Demo mode: nothing was saved");
      return;
    }
    setStatus.mutate({ endeavourId: endeavour.id, status }, { onSettled: () => setConfirmArchive(false) });
  };

  if (endeavour.status === "archived") return null;

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="endeavour-status-controls">
      {endeavour.status === "active" && (
        <Button size="sm" disabled={busy} onClick={() => run("paused")}>
          Pause
        </Button>
      )}
      {endeavour.status === "paused" && (
        <Button variant="primary" size="sm" disabled={busy} onClick={() => run("active")}>
          Resume
        </Button>
      )}
      {confirmArchive ? (
        <>
          <Button variant="destructive" size="sm" disabled={busy} onClick={() => run("archived")}>
            Confirm archive
          </Button>
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => setConfirmArchive(false)}>
            Keep
          </Button>
        </>
      ) : (
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => setConfirmArchive(true)}>
          Archive
        </Button>
      )}
    </div>
  );
}
