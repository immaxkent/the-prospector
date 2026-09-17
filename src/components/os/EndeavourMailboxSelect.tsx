import { toast } from "sonner";
import type { Endeavour } from "@/data/types";
import { useAppMode, useDataset } from "@/data/store";
import { useAssignEndeavourMailbox } from "@/data/mutations";
import { MachineLabel } from "./primitives";

/** The mailbox this endeavour sends through. Only connected mailboxes can be chosen. */
export function EndeavourMailboxSelect({ endeavour }: { endeavour: Endeavour }) {
  const mode = useAppMode();
  const { mailboxes } = useDataset();
  const assign = useAssignEndeavourMailbox();
  const current = mailboxes.find((m) => m.id === endeavour.mailboxId);
  const connected = mailboxes.filter((m) => m.status === "connected");

  return (
    <label className="flex items-center gap-2" data-testid="endeavour-mailbox">
      <MachineLabel>SENDS FROM</MachineLabel>
      <select
        aria-label="Sending mailbox"
        className="rounded-[3px] border border-border bg-card px-2 py-1 text-[12px]"
        value={endeavour.mailboxId ?? ""}
        disabled={assign.isPending || endeavour.status === "archived"}
        onChange={(e) => {
          if (mode === "demo") {
            toast("Demo mode: nothing was saved");
            return;
          }
          assign.mutate({ endeavourId: endeavour.id, mailboxId: e.target.value });
        }}
      >
        {!current && <option value="">No mailbox</option>}
        {current && current.status !== "connected" && (
          <option value={current.id}>
            {current.address} ({current.status.replace("_", " ")})
          </option>
        )}
        {connected.map((m) => (
          <option key={m.id} value={m.id}>
            {m.address}
          </option>
        ))}
      </select>
      {current && current.status !== "connected" && <MachineLabel className="text-warn">CANNOT SEND</MachineLabel>}
    </label>
  );
}
