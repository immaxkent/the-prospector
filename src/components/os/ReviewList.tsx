import { useState } from "react";
import { toast } from "sonner";
import type { Prospect } from "@/data/types";
import { useAddCompanyContact, useHoldProspect, useReleaseProspects } from "@/data/mutations";
import { useAppMode } from "@/data/store";
import { Button, MachineLabel, Tag } from "./primitives";
import { cn } from "@/lib/utils";

const CHANNELS = ["email", "form", "discord", "telegram", "x", "linkedin", "other"] as const;

const CHANNEL_GLYPH: Record<string, string> = {
  email: "✉",
  form: "▤",
  discord: "◇",
  telegram: "◈",
  x: "✕",
  linkedin: "in",
  other: "·",
};

const inputCls =
  "w-full rounded-[3px] border border-border bg-card px-2 py-1.5 text-[12px] outline-none focus:border-signal";

/**
 * Prospects waiting on a decision, and the decision.
 *
 * Reviewing is per-prospect but the decisions arrive together, so each row ticks and one
 * action at the foot commits them. The alternative — a button per row — costs a round trip
 * per judgement and turns twenty prospects into a chore.
 *
 * Each row carries enough to judge without opening it: who, why it scored what it did, and
 * how it can be reached. Expanding is for when something looks wrong, not for every row —
 * if the list cannot be read at a glance the ticking saves nothing.
 */
export function ReviewList({ endeavourId, prospects }: { endeavourId: string; prospects: readonly Prospect[] }) {
  const mode = useAppMode();
  const release = useReleaseProspects();
  const hold = useHoldProspect();
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<string | null>(null);

  const waiting = prospects.filter((p) => !p.releasedAt && (p.status === "QUALIFIED" || p.status === "NEEDS_REVIEW"));
  const released = prospects.filter((p) => p.releasedAt);

  if (waiting.length === 0 && released.length === 0) return null;

  const toggle = (id: string) =>
    setTicked((was) => {
      const next = new Set(was);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const submit = () => {
    if (mode === "demo") {
      toast("Demo mode: nothing was saved");
      return;
    }
    release.mutate(
      { endeavourId, prospectIds: [...ticked] },
      { onSuccess: () => setTicked(new Set()) },
    );
  };

  return (
    <div className="space-y-3" data-testid="review-list">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <MachineLabel>
          {waiting.length} WAITING ON YOU · {released.length} RELEASED
        </MachineLabel>
        {waiting.length > 0 && (
          <button
            type="button"
            className="machine text-muted-foreground hover:text-foreground"
            onClick={() => setTicked(ticked.size === waiting.length ? new Set() : new Set(waiting.map((p) => p.id)))}
          >
            {ticked.size === waiting.length ? "CLEAR ALL" : "TICK ALL"}
          </button>
        )}
      </div>

      <ul className="hairline-y">
        {waiting.map((prospect) => (
          <ReviewRow
            key={prospect.id}
            prospect={prospect}
            ticked={ticked.has(prospect.id)}
            expanded={open === prospect.id}
            onToggle={() => toggle(prospect.id)}
            onExpand={() => setOpen(open === prospect.id ? null : prospect.id)}
          />
        ))}
      </ul>

      {released.length > 0 && (
        <details className="rounded-[6px] border border-border">
          <summary className="machine cursor-pointer px-3 py-2 text-muted-foreground">
            {released.length} ALREADY RELEASED
          </summary>
          <ul className="hairline-y">
            {released.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <span className="text-[13px]">
                  {p.company} <span className="text-muted-foreground">· {p.person}</span>
                </span>
                <button
                  type="button"
                  className="machine text-muted-foreground hover:text-warn"
                  disabled={hold.isPending}
                  onClick={() => {
                    if (mode === "demo") {
                      toast("Demo mode: nothing was saved");
                      return;
                    }
                    hold.mutate({ prospectId: p.id });
                  }}
                >
                  HOLD
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}

      {/*
        The action follows the list rather than floating over it: a bar pinned to the
        viewport covers the last row on a short screen, which is the row most likely to
        have just been ticked. It says what will happen, not "confirm".
      */}
      {ticked.size > 0 && (
        <div className="sticky bottom-4 z-20 flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-signal/40 bg-card/95 px-4 py-3 backdrop-blur">
          <MachineLabel>
            {ticked.size} TICKED · NOTHING IS SENT, DRAFTS COME BACK FOR APPROVAL
          </MachineLabel>
          <div className="flex items-center gap-3">
            <button type="button" className="machine text-muted-foreground hover:text-foreground" onClick={() => setTicked(new Set())}>
              CLEAR
            </button>
            <Button variant="primary" size="sm" disabled={release.isPending} onClick={submit}>
              {release.isPending ? "Releasing…" : `Release ${ticked.size} for outreach`}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function ReviewRow({
  prospect,
  ticked,
  expanded,
  onToggle,
  onExpand,
}: {
  prospect: Prospect;
  ticked: boolean;
  expanded: boolean;
  onToggle: () => void;
  onExpand: () => void;
}) {
  const reachable = prospect.contacts.length > 0;
  return (
    <li className={cn("px-3 py-2.5 transition-colors", ticked && "bg-signal/[0.04]")} data-testid="review-row">
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={ticked}
          onChange={onToggle}
          aria-label={`Release ${prospect.company}`}
          className="mt-1 h-4 w-4 shrink-0 accent-[var(--signal)]"
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] font-medium">{prospect.company}</span>
            <span className="machine text-foreground/45">{prospect.score}/100</span>
            {prospect.status === "NEEDS_REVIEW" && <Tag tone="warn">NEEDS REVIEW</Tag>}
            {!reachable && <Tag tone="neutral">NO CONTACT</Tag>}
          </div>
          {/* The reason is the whole point of the row: it is why this scored what it did. */}
          <p className="mt-1 line-clamp-2 text-[12px] text-muted-foreground">
            {prospect.scoreReason || prospect.trigger || "No reason recorded."}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            {prospect.contacts.slice(0, 4).map((c) => (
              <span key={`${c.channel}:${c.value}`} className="machine text-foreground/55">
                {CHANNEL_GLYPH[c.channel] ?? "·"} {c.value}
              </span>
            ))}
            <button type="button" className="machine text-signal hover:underline" onClick={onExpand}>
              {/* Only offer to add one where a company exists to hang it on, or the row
                  promises a form the panel will not show. */}
              {expanded ? "LESS" : !reachable && prospect.companyId ? "ADD A CONTACT" : "MORE"}
            </button>
          </div>
        </div>
      </div>

      {expanded && <RowDetail prospect={prospect} />}
    </li>
  );
}

function RowDetail({ prospect }: { prospect: Prospect }) {
  const mode = useAppMode();
  const add = useAddCompanyContact();
  const [channel, setChannel] = useState<(typeof CHANNELS)[number]>("email");
  const [value, setValue] = useState("");

  return (
    <div className="ml-7 mt-3 space-y-3 border-l border-border pl-3">
      <div>
        <MachineLabel>WHY IT SCORED {prospect.score}</MachineLabel>
        <ul className="mt-1 space-y-0.5">
          {prospect.scoreFactors.map((f) => (
            <li key={f.label} className="flex gap-2 text-[12px]">
              <span className="w-[130px] shrink-0 text-muted-foreground">{f.label}</span>
              <span className="w-8 shrink-0 tabular-nums text-foreground/70">{f.weight}</span>
              <span className="text-muted-foreground">{f.note}</span>
            </li>
          ))}
        </ul>
      </div>

      {prospect.contacts.length > 0 && (
        <div>
          <MachineLabel>WAYS IN</MachineLabel>
          <ul className="mt-1 space-y-0.5">
            {prospect.contacts.map((c) => (
              <li key={`${c.channel}:${c.value}`} className="text-[12px]">
                <span className="text-muted-foreground">{c.channel}</span> {c.value}
              </li>
            ))}
          </ul>
        </div>
      )}

      {prospect.companyId && (
        <div className="space-y-1.5">
          <MachineLabel>ADD ONE YOU FOUND</MachineLabel>
          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label={`Contact channel for ${prospect.company}`}
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
              aria-label={`Contact for ${prospect.company}`}
              className={cn(inputCls, "w-[240px]")}
              placeholder={channel === "email" ? "hello@company.com" : "@handle or URL"}
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
            <Button
              size="sm"
              disabled={!value.trim() || add.isPending}
              onClick={() => {
                if (mode === "demo") {
                  toast("Demo mode: nothing was saved");
                  return;
                }
                add.mutate(
                  { companyId: prospect.companyId!, channel, value: value.trim() },
                  { onSuccess: () => setValue("") },
                );
              }}
            >
              {add.isPending ? "Adding…" : "Add"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
