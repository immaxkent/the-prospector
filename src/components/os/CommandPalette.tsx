import { useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { MachineLabel } from "./primitives";
import { useDataset } from "@/data/store";
import { cn } from "@/lib/utils";

interface Cmd {
  label: string;
  hint: string;
  run: () => void;
}

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const { prospects } = useDataset();
  const [q, setQ] = useState("");
  const [cursor, setCursor] = useState(0);

  const commands: Cmd[] = useMemo(() => {
    const base: Cmd[] = [
      { label: "New endeavour", hint: "ENDEAVOURS", run: () => navigate({ to: "/endeavours" }) },
      { label: "Run research", hint: "RESEARCH", run: () => navigate({ to: "/research" }) },
      { label: "Open approvals", hint: "COMMAND", run: () => navigate({ to: "/command" }) },
      { label: "Open inbox", hint: "INBOX", run: () => navigate({ to: "/inbox" }) },
      { label: "Open pipeline", hint: "PIPELINE", run: () => navigate({ to: "/pipeline" }) },
      { label: "Interfaces status", hint: "INTERFACES", run: () => navigate({ to: "/interfaces" }) },
    ];
    const people: Cmd[] = prospects.map((p) => ({
      label: `Find prospect · ${p.person} — ${p.company}`,
      hint: "PROSPECTS",
      run: () => navigate({ to: "/prospects" }),
    }));
    return [...base, ...people];
  }, [navigate, prospects]);

  const filtered = commands.filter((c) => c.label.toLowerCase().includes(q.toLowerCase()));

  useEffect(() => {
    if (open) {
      setQ("");
      setCursor(0);
    }
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-foreground/15 pt-[14vh]" onClick={onClose}>
      <div
        className="w-full max-w-[560px] overflow-hidden rounded-[4px] border border-border bg-card"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          autoFocus
          value={q}
          placeholder="Type a command…"
          onChange={(e) => {
            setQ(e.target.value);
            setCursor(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
            if (e.key === "ArrowDown") setCursor((c) => Math.min(c + 1, filtered.length - 1));
            if (e.key === "ArrowUp") setCursor((c) => Math.max(c - 1, 0));
            if (e.key === "Enter" && filtered[cursor]) {
              filtered[cursor].run();
              onClose();
            }
          }}
          className="w-full border-b border-border bg-card px-4 py-3 font-mono text-[13px] outline-none placeholder:text-muted-foreground"
        />
        <ul className="max-h-[320px] overflow-y-auto py-1">
          {filtered.length === 0 && (
            <li className="px-4 py-6 text-center">
              <MachineLabel>NO MATCHING COMMAND</MachineLabel>
            </li>
          )}
          {filtered.map((c, i) => (
            <li key={c.label}>
              <button
                onMouseEnter={() => setCursor(i)}
                onClick={() => {
                  c.run();
                  onClose();
                }}
                className={cn(
                  "flex w-full items-center justify-between gap-4 px-4 py-2 text-left text-[13px]",
                  i === cursor && "bg-signal-soft",
                )}
              >
                <span className="truncate">{c.label}</span>
                <MachineLabel>{c.hint}</MachineLabel>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
