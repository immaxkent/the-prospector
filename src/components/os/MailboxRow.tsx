import { useState } from "react";
import { toast } from "sonner";
import type { Mailbox } from "@/data/types";
import { useAppMode } from "@/data/store";
import { useDisconnectMailbox, useUpdateMailboxLimits } from "@/data/mutations";
import { Button, MachineLabel, Tag } from "./primitives";

const inputCls =
  "w-full rounded-[3px] border border-border bg-card px-2 py-1.5 text-[12px] outline-none focus:border-signal";

const today = () => new Date().toISOString().slice(0, 10);

/** One mailbox: shared usage, editable limits, and disconnection. */
export function MailboxRow({ mailbox: m }: { mailbox: Mailbox }) {
  const mode = useAppMode();
  const save = useUpdateMailboxLimits();
  const disconnect = useDisconnectMailbox();
  const [panel, setPanel] = useState<"none" | "limits" | "disconnect">("none");
  const [form, setForm] = useState({
    dailyCap: String(m.limits.dailyCap),
    weeklyCap: String(m.limits.weeklyCap),
    warmup: m.limits.warmup !== null,
    startCap: String(m.limits.warmup?.startCap ?? 5),
    incrementPerDay: String(m.limits.warmup?.incrementPerDay ?? 2),
    quietStart: String(m.limits.quietHours.start),
    quietEnd: String(m.limits.quietHours.end),
    timezone: m.limits.timezone,
  });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({
      ...f,
      [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value,
    }));
  const busy = save.isPending || disconnect.isPending;

  const inDemo = () => {
    if (mode === "demo") toast("Demo mode: nothing was saved");
    return mode === "demo";
  };

  const submitLimits = () => {
    if (inDemo()) return;
    save.mutate(
      {
        mailboxId: m.id,
        limits: {
          dailyCap: Number(form.dailyCap),
          weeklyCap: Number(form.weeklyCap),
          warmup: form.warmup
            ? {
                startedOn: m.limits.warmup?.startedOn ?? today(),
                startCap: Number(form.startCap),
                incrementPerDay: Number(form.incrementPerDay),
              }
            : null,
          quietHours: { start: Number(form.quietStart), end: Number(form.quietEnd) },
          timezone: form.timezone.trim(),
        },
      },
      { onSuccess: () => setPanel("none") },
    );
  };

  return (
    <div className="px-4 py-3" data-testid="mailbox-row">
      <div className="flex items-center justify-between gap-3">
        <span className="min-w-0">
          <span className="block truncate text-[13px]">{m.displayName}</span>
          <span className="machine block truncate">{m.address}</span>
        </span>
        <Tag
          tone={
            m.status === "connected" ? "signal" : m.status === "needs_reauth" ? "warn" : "neutral"
          }
        >
          {m.status.replace("_", " ").toUpperCase()}
        </Tag>
      </div>
      <div className="machine mt-2 flex flex-wrap gap-x-4 gap-y-1">
        <span>
          SENT TODAY {m.sentToday}/{m.capToday}
          {m.warmingUp ? ` · WARMING UP TO ${m.dailyCap}` : ""}
        </span>
        <span>QUIET {m.quietHours}</span>
        <span>
          {m.endeavourIds.length} {m.endeavourIds.length === 1 ? "ENDEAVOUR" : "ENDEAVOURS"}
        </span>
      </div>

      {panel === "limits" && (
        <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
          <label className="space-y-1">
            <MachineLabel>DAILY CAP</MachineLabel>
            <input
              aria-label="Daily cap"
              className={`${inputCls} numeral`}
              value={form.dailyCap}
              onChange={set("dailyCap")}
            />
          </label>
          <label className="space-y-1">
            <MachineLabel>WEEKLY CAP</MachineLabel>
            <input
              aria-label="Weekly cap"
              className={`${inputCls} numeral`}
              value={form.weeklyCap}
              onChange={set("weeklyCap")}
            />
          </label>
          <label className="space-y-1">
            <MachineLabel>QUIET FROM (HOUR)</MachineLabel>
            <input
              aria-label="Quiet from"
              className={`${inputCls} numeral`}
              value={form.quietStart}
              onChange={set("quietStart")}
            />
          </label>
          <label className="space-y-1">
            <MachineLabel>QUIET UNTIL (HOUR)</MachineLabel>
            <input
              aria-label="Quiet until"
              className={`${inputCls} numeral`}
              value={form.quietEnd}
              onChange={set("quietEnd")}
            />
          </label>
          <label className="col-span-2 space-y-1">
            <MachineLabel>TIMEZONE</MachineLabel>
            <input
              aria-label="Timezone"
              className={inputCls}
              value={form.timezone}
              onChange={set("timezone")}
            />
          </label>
          <label className="col-span-2 flex items-end gap-2 pb-1.5">
            <input
              aria-label="Warm up"
              type="checkbox"
              checked={form.warmup}
              onChange={set("warmup")}
            />
            <MachineLabel>WARM UP A NEW MAILBOX</MachineLabel>
          </label>
          {form.warmup && (
            <>
              <label className="space-y-1">
                <MachineLabel>START AT / DAY</MachineLabel>
                <input
                  aria-label="Warm-up start"
                  className={`${inputCls} numeral`}
                  value={form.startCap}
                  onChange={set("startCap")}
                />
              </label>
              <label className="space-y-1">
                <MachineLabel>ADD PER DAY</MachineLabel>
                <input
                  aria-label="Warm-up increment"
                  className={`${inputCls} numeral`}
                  value={form.incrementPerDay}
                  onChange={set("incrementPerDay")}
                />
              </label>
            </>
          )}
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {panel === "limits" ? (
          <>
            <Button variant="primary" size="sm" disabled={busy} onClick={submitLimits}>
              Save limits
            </Button>
            <Button size="sm" onClick={() => setPanel("none")}>
              Cancel
            </Button>
          </>
        ) : panel === "disconnect" ? (
          <>
            <Button
              variant="destructive"
              size="sm"
              disabled={busy}
              onClick={() =>
                inDemo() ||
                disconnect.mutate({ mailboxId: m.id }, { onSuccess: () => setPanel("none") })
              }
            >
              Confirm disconnect
            </Button>
            <Button size="sm" onClick={() => setPanel("none")}>
              Keep
            </Button>
            {m.endeavourIds.length > 0 && (
              <MachineLabel className="self-center">
                {m.endeavourIds.length} ENDEAVOUR(S) WILL STOP SENDING UNTIL RECONNECTED
              </MachineLabel>
            )}
          </>
        ) : (
          <>
            <Button size="sm" onClick={() => setPanel("limits")}>
              Edit limits
            </Button>
            {m.status !== "connected" && (
              <a
                href="/mailboxes/google/connect"
                className="machine inline-flex h-7 items-center rounded-full border border-border px-3 hover:bg-accent"
              >
                Reconnect
              </a>
            )}
            {m.status !== "disconnected" && (
              <Button variant="ghost" size="sm" onClick={() => setPanel("disconnect")}>
                Disconnect
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
