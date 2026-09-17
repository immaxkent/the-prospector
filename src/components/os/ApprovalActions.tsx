import { useState } from "react";
import { toast } from "sonner";
import type { Approval } from "@/data/types";
import { useAppMode, useDataset } from "@/data/store";
import { useDecideApproval } from "@/data/mutations";
import { Button, MachineLabel } from "./primitives";

const inputCls =
  "w-full rounded-[3px] border border-border bg-card px-2.5 py-2 text-[13px] outline-none focus:border-signal";

const ACKNOWLEDGE_ONLY = new Set(["HOT_LEAD", "PRICING_DECISION", "FAILED_RUN"]);

/**
 * Decision controls for one approval. In demo mode decisions are not saved;
 * `onDemoResolve` lets the caller hide the item locally.
 */
export function ApprovalActions({
  approval,
  onDemoResolve,
}: {
  approval: Approval;
  onDemoResolve?: ((id: string) => void) | undefined;
}) {
  const mode = useAppMode();
  const { prospects } = useDataset();
  const decide = useDecideApproval();
  const [panel, setPanel] = useState<"none" | "edit" | "reject">("none");
  const [copy, setCopy] = useState(approval.copy);
  const [note, setNote] = useState("");
  const [prospectId, setProspectId] = useState("");
  const busy = decide.isPending;

  function submit(
    decision: "approve" | "reject",
    extra: { editedCopy?: string; note?: string; prospectId?: string } = {},
  ) {
    if (mode === "demo") {
      toast("Demo mode: nothing was saved");
      onDemoResolve?.(approval.id);
      return;
    }
    decide.mutate(
      { approvalId: approval.id, decision, ...extra },
      { onSuccess: () => setPanel("none") },
    );
  }

  if (approval.kind === "THREAD_MAPPING") {
    const candidates = prospects.filter(
      (p) => p.endeavourId === approval.endeavourId && p.status !== "REJECTED",
    );
    return (
      <div className="space-y-2" data-testid="approval-actions">
        <select
          aria-label="Prospect for this reply"
          className={inputCls}
          value={prospectId}
          onChange={(e) => setProspectId(e.target.value)}
        >
          <option value="">Choose the prospect who replied…</option>
          {candidates.map((p) => (
            <option key={p.id} value={p.id}>
              {p.person} — {p.company}
            </option>
          ))}
        </select>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="primary"
            size="sm"
            disabled={busy || !prospectId}
            onClick={() => submit("approve", { prospectId })}
          >
            Assign
          </Button>
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => submit("reject")}>
            Ignore thread
          </Button>
        </div>
      </div>
    );
  }

  if (ACKNOWLEDGE_ONLY.has(approval.kind)) {
    return (
      <div className="flex flex-wrap gap-2" data-testid="approval-actions">
        <Button variant="primary" size="sm" disabled={busy} onClick={() => submit("approve")}>
          Acknowledge
        </Button>
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => submit("reject")}>
          Dismiss
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-2" data-testid="approval-actions">
      {panel === "edit" && (
        <div className="space-y-1.5">
          <MachineLabel>EDIT BEFORE APPROVING</MachineLabel>
          <textarea
            aria-label="Draft copy"
            className={inputCls}
            rows={6}
            value={copy}
            onChange={(e) => setCopy(e.target.value)}
          />
        </div>
      )}
      {panel === "reject" && (
        <input
          aria-label="Reason for rejecting"
          className={inputCls}
          placeholder="Reason (optional)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      )}
      <div className="flex flex-wrap gap-2">
        {panel === "edit" ? (
          <>
            <Button
              variant="primary"
              size="sm"
              disabled={busy || !copy.trim()}
              onClick={() => submit("approve", copy !== approval.copy ? { editedCopy: copy } : {})}
            >
              Approve edited
            </Button>
            <Button size="sm" disabled={busy} onClick={() => setPanel("none")}>
              Cancel
            </Button>
          </>
        ) : panel === "reject" ? (
          <>
            <Button
              variant="destructive"
              size="sm"
              disabled={busy}
              onClick={() => submit("reject", note.trim() ? { note: note.trim() } : {})}
            >
              Confirm reject
            </Button>
            <Button size="sm" disabled={busy} onClick={() => setPanel("none")}>
              Cancel
            </Button>
          </>
        ) : (
          <>
            <Button variant="primary" size="sm" disabled={busy} onClick={() => submit("approve")}>
              Approve
            </Button>
            <Button size="sm" disabled={busy} onClick={() => setPanel("edit")}>
              Edit
            </Button>
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => setPanel("reject")}>
              Reject
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
