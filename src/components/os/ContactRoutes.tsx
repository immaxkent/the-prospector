import { useState } from "react";
import { toast } from "sonner";
import type { ContactRoute } from "@/data/types";
import {
  useAddCompanyContact,
  useRemoveCompanyContact,
  useSetPreferredContact,
} from "@/data/mutations";
import { useAppMode } from "@/data/store";
import { Button, MachineLabel, Tag } from "./primitives";
import { cn } from "@/lib/utils";

const CHANNELS = ["email", "form", "discord", "telegram", "x", "linkedin", "other"] as const;

const inputCls =
  "rounded-[3px] border border-border bg-card px-2.5 py-2 text-[13px] outline-none focus:border-signal";

/**
 * Every way in, and where each one came from.
 *
 * Research finds generic inboxes and community channels; the operator finds the rest. Both
 * belong here, and which is which matters: "the agent could not find anyone" and "I typed
 * this in myself" are different facts about the same company, and acting on the second as
 * though it were the first wastes the work.
 *
 * One route is marked as the one an email would go to. Marked rather than merely listed
 * first, because that is the question being asked of a list of four addresses, and the
 * ranking is the sender's own so the screen cannot disagree with what would happen.
 */
export function ContactRoutes({
  routes,
  companyId,
  companyName,
}: {
  routes: readonly ContactRoute[];
  companyId: string | null;
  companyName: string;
}) {
  const mode = useAppMode();
  const add = useAddCompanyContact();
  const choose = useSetPreferredContact();
  const remove = useRemoveCompanyContact();
  const busy = add.isPending || choose.isPending || remove.isPending;

  /** Demo mode has no database: say so rather than appearing to save. */
  const inDemo = () => {
    if (mode === "demo") toast("Demo mode: nothing was saved");
    return mode === "demo";
  };
  const [channel, setChannel] = useState<(typeof CHANNELS)[number]>("email");
  const [value, setValue] = useState("");
  const [sourceRef, setSourceRef] = useState("");

  const submit = () => {
    if (inDemo()) return;
    if (!companyId) return;
    add.mutate(
      {
        companyId,
        channel,
        value: value.trim(),
        ...(sourceRef.trim() ? { sourceRef: sourceRef.trim() } : {}),
      },
      {
        onSuccess: () => {
          setValue("");
          setSourceRef("");
        },
      },
    );
  };

  return (
    <div className="space-y-4" data-testid="contact-routes">
      {routes.length === 0 ? (
        <p className="text-[13px] text-muted-foreground" data-testid="no-routes">
          No route to this company was found. Nothing can be sent until one is added — a generic
          inbox, a contact form, a Discord or Telegram invite all count.
        </p>
      ) : (
        <ul className="hairline-y">
          {routes.map((r) => (
            <li
              key={`${r.channel}:${r.value}`}
              className="flex flex-wrap items-center gap-2 py-2"
              data-testid="contact-route"
              data-channel={r.channel}
            >
              <MachineLabel tone={r.preferred ? "signal" : "muted"}>
                {r.channel.toUpperCase()}
              </MachineLabel>
              <span className={cn("text-[13px]", r.preferred && "font-medium")}>{r.value}</span>
              {r.preferred && <Tag tone="signal">WOULD BE USED</Tag>}
              {!r.sendable && <Tag tone="warn">YOU OPEN THIS</Tag>}
              {r.sendable && !r.named && <Tag>GENERIC INBOX</Tag>}
              <span className="machine ml-auto text-muted-foreground">
                {r.foundBy === "agent" ? "FOUND BY RESEARCH" : "YOU ADDED THIS"}
              </span>
              {r.sourceRef && (
                <a
                  href={r.sourceRef}
                  target="_blank"
                  rel="noreferrer"
                  className="machine text-muted-foreground underline hover:text-foreground"
                >
                  SOURCE
                </a>
              )}
              {companyId && (
                <>
                  <button
                    type="button"
                    aria-label={`${r.preferred ? "Stop using" : "Use"} ${r.value}`}
                    className="machine text-muted-foreground hover:text-foreground"
                    disabled={busy}
                    onClick={() =>
                      inDemo() || choose.mutate({ companyId, channel: r.channel, value: r.value })
                    }
                  >
                    {r.preferred ? "UNSET" : "USE THIS"}
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove ${r.value}`}
                    className="machine text-muted-foreground hover:text-danger"
                    disabled={busy}
                    onClick={() =>
                      inDemo() || remove.mutate({ companyId, channel: r.channel, value: r.value })
                    }
                  >
                    REMOVE
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {companyId && (
        <div className="space-y-1.5">
          <MachineLabel>ADD ONE YOU FOUND</MachineLabel>
          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label={`Contact channel for ${companyName}`}
              className={cn(inputCls, "w-[120px]")}
              value={channel}
              onChange={(e) => setChannel(e.target.value as (typeof CHANNELS)[number])}
            >
              {CHANNELS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <input
              aria-label={`New contact for ${companyName}`}
              className={cn(inputCls, "w-[220px]")}
              placeholder={channel === "email" ? "hello@company.com" : "handle or URL"}
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
            <input
              aria-label={`Where you found the contact for ${companyName}`}
              className={cn(inputCls, "w-[200px]")}
              placeholder="Where you found it (optional)"
              value={sourceRef}
              onChange={(e) => setSourceRef(e.target.value)}
            />
            <Button size="sm" disabled={!value.trim() || busy} onClick={submit}>
              {add.isPending ? "Saving…" : "Add"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
