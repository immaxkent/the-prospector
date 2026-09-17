import { useState } from "react";
import { toast } from "sonner";
import type { Prospect } from "@/data/types";
import { useAppMode, useDataset } from "@/data/store";
import {
  useMoveProspectStage,
  useRejectProspect,
  useRestoreProspect,
  useSuppressProspect,
} from "@/data/mutations";
import { ApprovalActions } from "./ApprovalActions";
import { Button, MachineLabel } from "./primitives";

const inputCls =
  "w-full rounded-[3px] border border-border bg-card px-2.5 py-2 text-[13px] outline-none focus:border-signal";

const STAGES = [
  "discovered",
  "researched",
  "qualified",
  "contacted",
  "replied",
  "meeting",
  "proposal",
  "won",
  "lost",
  "nurture",
] as const;
type Stage = (typeof STAGES)[number];

/** Inspector footer for one prospect: its pending draft decision, stage correction, suppression and rejection. */
export function ProspectActions({ prospect }: { prospect: Prospect }) {
  const mode = useAppMode();
  const { approvals } = useDataset();
  const move = useMoveProspectStage();
  const reject = useRejectProspect();
  const restore = useRestoreProspect();
  const suppress = useSuppressProspect();
  const [panel, setPanel] = useState<"none" | "reject" | "suppress">("none");
  const [reason, setReason] = useState("");
  const [scope, setScope] = useState<"email" | "domain">("email");
  const busy = move.isPending || reject.isPending || restore.isPending || suppress.isPending;

  const pending = approvals.find(
    (a) =>
      a.prospectId === prospect.id && (a.kind === "OUTREACH_DRAFT" || a.kind === "REPLY_APPROVAL"),
  );

  /** Demo mode has no database: say so instead of pretending to save. */
  const inDemo = () => {
    if (mode === "demo") toast("Demo mode: nothing was saved");
    return mode === "demo";
  };
  const done = {
    onSuccess: () => {
      setPanel("none");
      setReason("");
    },
  };

  if (prospect.status === "REJECTED") {
    return (
      <div
        className="flex flex-wrap items-center justify-between gap-2"
        data-testid="prospect-actions"
      >
        <MachineLabel>REJECTED — NOTHING WILL BE SENT</MachineLabel>
        <Button
          size="sm"
          disabled={busy}
          onClick={() => inDemo() || restore.mutate({ prospectId: prospect.id })}
        >
          Restore for review
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3" data-testid="prospect-actions">
      {pending ? (
        <div className="space-y-1.5">
          <MachineLabel tone="signal">PENDING {pending.kind.replace("_", " ")}</MachineLabel>
          <ApprovalActions approval={pending} />
        </div>
      ) : (
        <MachineLabel>NO DRAFT AWAITING APPROVAL</MachineLabel>
      )}

      {panel === "reject" && (
        <input
          aria-label="Reason for rejecting the prospect"
          className={inputCls}
          placeholder="Why is this not a fit?"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      )}
      {panel === "suppress" && (
        <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-2">
          <select
            aria-label="Suppression scope"
            className={inputCls}
            value={scope}
            onChange={(e) => setScope(e.target.value as "email" | "domain")}
          >
            <option value="email">This person</option>
            <option value="domain">Whole domain</option>
          </select>
          <input
            aria-label="Reason for suppressing"
            className={inputCls}
            placeholder="Reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-2">
          <MachineLabel>STAGE</MachineLabel>
          <select
            aria-label="Move stage"
            className="rounded-[3px] border border-border bg-card px-2 py-1 text-[12px]"
            value={prospect.stage}
            disabled={busy}
            onChange={(e) =>
              inDemo() || move.mutate({ prospectId: prospect.id, to: e.target.value as Stage })
            }
          >
            {STAGES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <div className="flex gap-2">
          {panel === "none" ? (
            <>
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => setPanel("suppress")}
              >
                Suppress
              </Button>
              <Button
                variant="destructive"
                size="sm"
                disabled={busy}
                onClick={() => setPanel("reject")}
              >
                Reject
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="destructive"
                size="sm"
                disabled={busy || (panel === "reject" && !reason.trim())}
                onClick={() => {
                  if (inDemo()) return;
                  if (panel === "reject") reject.mutate({ prospectId: prospect.id, reason }, done);
                  else suppress.mutate({ prospectId: prospect.id, scope, reason }, done);
                }}
              >
                {panel === "reject" ? "Confirm reject" : "Confirm suppress"}
              </Button>
              <Button size="sm" disabled={busy} onClick={() => setPanel("none")}>
                Cancel
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
