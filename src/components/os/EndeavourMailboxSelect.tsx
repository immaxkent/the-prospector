import { toast } from "sonner";
import type { Endeavour } from "@/data/types";
import { useAppMode, useDataset } from "@/data/store";
import { useAssignEndeavourMailbox, useSetEndeavourFromAlias } from "@/data/mutations";
import { MachineLabel } from "./primitives";

/** The mailbox this endeavour sends through. Only connected mailboxes can be chosen. */
export function EndeavourMailboxSelect({ endeavour }: { endeavour: Endeavour }) {
  const mode = useAppMode();
  const { mailboxes } = useDataset();
  const assign = useAssignEndeavourMailbox();
  const setAlias = useSetEndeavourFromAlias();
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

      {current && current.aliases.length > 0 && (
        <>
          <MachineLabel>AS</MachineLabel>
          <select
            aria-label="Sending address"
            className="rounded-[3px] border border-border bg-card px-2 py-1 text-[12px]"
            value={endeavour.fromAlias ?? ""}
            disabled={setAlias.isPending || endeavour.status === "archived"}
            onChange={(e) => {
              if (mode === "demo") {
                toast("Demo mode: nothing was saved");
                return;
              }
              setAlias.mutate({ endeavourId: endeavour.id, alias: e.target.value || null });
            }}
          >
            <option value="">{current.address}</option>
            {current.aliases.map((a) => (
              <option key={a.address} value={a.address}>
                {a.address}
              </option>
            ))}
          </select>
        </>
      )}
    </label>
  );
}
