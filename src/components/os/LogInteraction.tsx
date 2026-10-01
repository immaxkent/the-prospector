import { useState } from "react";
import { toast } from "sonner";
import { useLogInteraction } from "@/data/mutations";
import { useAppMode } from "@/data/store";
import { Button, MachineLabel } from "./primitives";

const CHANNELS = [
  { id: "discord", label: "DISCORD" },
  { id: "linkedin", label: "LINKEDIN" },
  { id: "x", label: "X" },
  { id: "call", label: "CALL" },
  { id: "in_person", label: "IN PERSON" },
  { id: "email", label: "EMAIL (YOUR OWN CLIENT)" },
  { id: "other", label: "OTHER" },
] as const;

const inputCls =
  "w-full rounded-[3px] border border-border bg-card px-2.5 py-2 text-[13px] outline-none focus:border-signal";

/**
 * Recording a conversation the mailbox never saw.
 *
 * Without it a prospect already in talks on Discord reads as pending forever: it holds a
 * slot, the buffer fills, and prospecting stops for a reason that is not true.
 *
 * What it does not do is enter the conversion rates. Those describe what happens when this
 * endeavour sends a cold email, and a Discord thread is not one — the copy says so, because
 * an operator who thinks this improves their reply rate will misread every number after it.
 */
export function LogInteraction({ prospectId }: { prospectId: string }) {
  const mode = useAppMode();
  const log = useLogInteraction();
  const [open, setOpen] = useState(false);
  const [channel, setChannel] = useState<(typeof CHANNELS)[number]["id"]>("discord");
  const [direction, setDirection] = useState<"outbound" | "inbound">("inbound");
  const [when, setWhen] = useState(() => new Date().toLocaleDateString("en-CA"));
  const [note, setNote] = useState("");

  if (!open) {
    return (
      <Button size="sm" onClick={() => setOpen(true)} data-testid="log-contact">
        Log contact elsewhere
      </Button>
    );
  }

  /*
   * A date has no time, and the time chosen for it has to be one that has already happened.
   * Noon was the obvious choice and it was wrong twice over: logging a call at ten in the
   * morning read as four hours in the future, and comparing against a UTC "today" refuses
   * the current day outright for anyone east of UTC, whose local today is UTC yesterday.
   *
   * So the comparison is on local dates, today means now, and an earlier day means the end
   * of that day where the operator is.
   */
  const today = new Date().toLocaleDateString("en-CA");
  const occurredAt = when === today ? new Date() : new Date(`${when}T23:59:59`);
  const problem = Number.isNaN(occurredAt.getTime())
    ? "That is not a date."
    : when > today
      ? "That date has not happened yet."
      : null;

  return (
    <div className="space-y-3" data-testid="log-interaction">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <label className="space-y-1">
          <MachineLabel>WHERE</MachineLabel>
          <select aria-label="Channel" className={inputCls} value={channel} onChange={(e) => setChannel(e.target.value as typeof channel)}>
            {CHANNELS.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <MachineLabel>WHICH WAY</MachineLabel>
          <select
            aria-label="Direction"
            className={inputCls}
            value={direction}
            onChange={(e) => setDirection(e.target.value as "outbound" | "inbound")}
          >
            <option value="inbound">THEY ANSWERED</option>
            <option value="outbound">I REACHED OUT</option>
          </select>
        </label>
      </div>

      <label className="space-y-1 block">
        <MachineLabel>WHEN IT HAPPENED</MachineLabel>
        <input aria-label="When it happened" className={inputCls} type="date" value={when} onChange={(e) => setWhen(e.target.value)} />
      </label>

      <label className="space-y-1 block">
        <MachineLabel>NOTE (OPTIONAL)</MachineLabel>
        <input aria-label="Note" className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>

      <p className="text-[13px] text-muted-foreground">
        {problem ?? (
          <>
            {direction === "inbound"
              ? "This moves the prospect to replied, so it stops holding a place in the pending buffer."
              : "This moves the prospect to contacted."}{" "}
            It is kept out of the reply and meeting rates: those describe what happens when this
            endeavour sends a cold email, and this was not one.
          </>
        )}
      </p>

      <div className="flex flex-wrap gap-2">
        <Button
          variant="primary"
          size="sm"
          disabled={log.isPending || !!problem}
          onClick={() => {
            if (mode === "demo") {
              toast("Demo mode: nothing was saved");
              setOpen(false);
              return;
            }
            log.mutate(
              { prospectId, channel, direction, occurredAt: occurredAt.toISOString(), note: note.trim() || null },
              { onSuccess: () => setOpen(false) },
            );
          }}
        >
          {log.isPending ? "Saving…" : "Record it"}
        </Button>
        <Button size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
