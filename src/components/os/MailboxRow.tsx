import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import type { Mailbox } from "@/data/types";
import { useAppMode } from "@/data/store";
import { useCreateMailboxAlias, useDisconnectMailbox, useUpdateMailboxLimits } from "@/data/mutations";
import { Button, MachineLabel, Tag } from "./primitives";

const inputCls =
  "w-full rounded-[3px] border border-border bg-card px-2 py-1.5 text-[12px] outline-none focus:border-signal";

const today = () => new Date().toISOString().slice(0, 10);

/** One mailbox: shared usage, editable limits, and disconnection. */
export function MailboxRow({ mailbox: m }: { mailbox: Mailbox }) {
  const mode = useAppMode();
  const save = useUpdateMailboxLimits();
  const disconnect = useDisconnectMailbox();
  const [panel, setPanel] = useState<"none" | "limits" | "disconnect" | "alias">("none");
  const addAlias = useCreateMailboxAlias();
  const domain = m.address.slice(m.address.indexOf("@"));
  const [alias, setAlias] = useState({ address: "", displayName: m.displayName });
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
  const busy = save.isPending || disconnect.isPending || addAlias.isPending;

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
        {m.aliases.length > 0 && (
          <span data-testid="mailbox-aliases">ALSO SENDS AS {m.aliases.map((a) => a.address).join(", ")}</span>
        )}
        {m.aliases.length > 0 && (
          <Link to="/walkthroughs" search={{ open: "gmail-send-as" }} className="text-signal hover:underline">
            NOT SENDING YET? →
          </Link>
        )}
      </div>

      {panel === "alias" && (
        <div className="mt-3 space-y-2" data-testid="alias-form">
          <p className="text-[13px] text-muted-foreground">
            A new address on any domain your Workspace owns, added to this account. It shares this
            mailbox&rsquo;s caps, because Google counts its sends against the same account.
          </p>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            <label className="space-y-1">
              <MachineLabel>ADDRESS</MachineLabel>
              <input
                aria-label="New address"
                className={inputCls}
                placeholder={`hello${domain}`}
                value={alias.address}
                onChange={(e) => setAlias((a) => ({ ...a, address: e.target.value }))}
              />
            </label>
            <label className="space-y-1">
              <MachineLabel>NAME RECIPIENTS SEE</MachineLabel>
              <input
                aria-label="Alias display name"
                className={inputCls}
                value={alias.displayName}
                onChange={(e) => setAlias((a) => ({ ...a, displayName: e.target.value }))}
              />
            </label>
          </div>
        </div>
      )}

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
        ) : panel === "alias" ? (
          <>
            <Button
              variant="primary"
              size="sm"
              disabled={busy || !alias.address.includes("@") || !alias.displayName.trim()}
              onClick={() =>
                inDemo() ||
                addAlias.mutate(
                  { mailboxId: m.id, address: alias.address.trim(), displayName: alias.displayName.trim() },
                  { onSuccess: () => { setPanel("none"); setAlias((a) => ({ ...a, address: "" })); } },
                )
              }
            >
              {addAlias.isPending ? "Creating…" : "Create address"}
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
            {m.status === "connected" &&
              (m.canCreateAliases ? (
                <Button size="sm" onClick={() => setPanel("alias")}>
                  Add an address
                </Button>
              ) : (
                <a
                  href="/mailboxes/google/connect?alias=1"
                  className="machine inline-flex h-7 items-center rounded-full border border-border px-3 hover:bg-accent"
                  title="Creating an address needs an administrator's consent, which this connection was not granted."
                >
                  Allow new addresses
                </a>
              ))}
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
