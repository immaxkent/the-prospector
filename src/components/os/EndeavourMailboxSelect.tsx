import { toast } from "sonner";
import type { Endeavour } from "@/data/types";
import { useAppMode, useDataset } from "@/data/store";
import { useAssignEndeavourMailbox, useSetEndeavourFromAlias } from "@/data/mutations";
import { parseSendingAddress, sendingAddressKey, sendingAddresses } from "@/data/sending-addresses";
import { MachineLabel } from "./primitives";

/**
 * The address this endeavour sends from: a connected mailbox, or one of its aliases.
 *
 * These were two controls, which read as two decisions when they are one. The mailbox is
 * still what is assigned underneath — an alias sends through its account and against its
 * cap — but that is the account's business, not a second question for the operator.
 */
export function EndeavourMailboxSelect({ endeavour }: { endeavour: Endeavour }) {
  const mode = useAppMode();
  const { mailboxes } = useDataset();
  const assign = useAssignEndeavourMailbox();
  const setAlias = useSetEndeavourFromAlias();
  const current = mailboxes.find((m) => m.id === endeavour.mailboxId);
  const addresses = sendingAddresses(mailboxes);
  const cannotSend = !!current && current.status !== "connected";
  const busy = assign.isPending || setAlias.isPending || endeavour.status === "archived";

  return (
    <label className="flex items-center gap-2" data-testid="endeavour-mailbox">
      <MachineLabel>SENDS FROM</MachineLabel>
      <select
        aria-label="Sending address"
        className="rounded-[3px] border border-border bg-card px-2 py-1 text-[12px]"
        value={cannotSend ? `broken:${current.id}` : sendingAddressKey(addresses, endeavour.mailboxId, endeavour.fromAlias)}
        disabled={busy}
        onChange={(e) => {
          const picked = parseSendingAddress(e.target.value);
          if (!picked || picked.mailboxId.startsWith("broken:")) return;
          if (mode === "demo") {
            toast("Demo mode: nothing was saved");
            return;
          }
          const alias = () => setAlias.mutate({ endeavourId: endeavour.id, alias: picked.alias });
          // The alias is checked against the endeavour's own mailbox, so it waits for the move.
          if (picked.mailboxId === endeavour.mailboxId) alias();
          else assign.mutate({ endeavourId: endeavour.id, mailboxId: picked.mailboxId }, { onSuccess: alias });
        }}
      >
        {!endeavour.mailboxId && <option value="">No mailbox</option>}
        {cannotSend && (
          // Kept in the list so a mailbox that needs attention is not quietly replaced by
          // whichever address happens to sort first.
          <option value={`broken:${current.id}`}>
            {current.address} ({current.status.replace("_", " ")})
          </option>
        )}
        {addresses.map((a) => (
          <option key={a.key} value={a.key}>
            {a.label}
          </option>
        ))}
      </select>
      {cannotSend && <MachineLabel className="text-warn">CANNOT SEND</MachineLabel>}
    </label>
  );
}
