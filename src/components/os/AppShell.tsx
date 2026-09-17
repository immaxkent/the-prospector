import { Link, useRouterState } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { StatusDot, Button } from "./primitives";
import { CommandPalette } from "./CommandPalette";
import { WorldCanvas } from "@/components/world/WorldCanvas";
import { useDataset, initDataMode, useRunState, startRun, dismissRun } from "@/data/store";
import { clockTime } from "@/lib/format";
import { useSwipeNav } from "@/hooks/use-swipe-nav";

/** Nav order doubles as the station order in the 3D world. */
const NAV: { to: string; label: string; key: string; glyph: string }[] = [
  { to: "/command", label: "Command", key: "01", glyph: "◈" },
  { to: "/endeavours", label: "Endeavours", key: "02", glyph: "◆" },
  { to: "/prospects", label: "Prospects", key: "03", glyph: "▤" },
  { to: "/pipeline", label: "Pipeline", key: "04", glyph: "▥" },
  { to: "/inbox", label: "Inbox", key: "05", glyph: "✉" },
  { to: "/research", label: "Research", key: "06", glyph: "◎" },
  { to: "/intelligence", label: "Intelligence", key: "07", glyph: "✦" },
  { to: "/interfaces", label: "Interfaces", key: "08", glyph: "⌘" },
  { to: "/settings", label: "Settings", key: "09", glyph: "⚙" },
];

export function AppShell({ children }: { children: ReactNode }) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const { status, endeavours, approvals } = useDataset();
  const run = useRunState();
  const running = run.phase !== "IDLE" && run.phase !== "DONE";
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  // Source: route hierarchy. Gestures move up inside a section, never across the navbar.
  const swipeParent = pathname.startsWith("/endeavours/") ? "/endeavours" : undefined;
  useSwipeNav(swipeParent);

  useEffect(() => {
    initDataMode();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Close the context dropdown on navigation and on Escape.
  useEffect(() => setContextOpen(false), [pathname]);
  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && setContextOpen(false);
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, []);

  const activeIndex = pathname === "/" ? 0 : Math.max(1, NAV.findIndex((n) => pathname.startsWith(n.to)) + 1);

  // Source: Endeavour state (first active endeavour is the working context)
  const context = endeavours[0]?.name ?? "No active endeavour";
  const agentTone = status.agent === "ERROR" ? "error" : status.agent === "WAITING" ? "idle" : "ok";

  return (
    <div className="relative min-h-screen">
      <WorldCanvas station={activeIndex} />

      {/* LEFT NAV — dynamic island rail, expands on hover */}
      <nav className="group/nav fixed left-4 top-1/2 z-40 hidden -translate-y-1/2 md:block">
        <div className="island-ink flex w-[58px] flex-col gap-1 rounded-3xl p-2 transition-[width] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover/nav:w-[210px]">
          <Link to="/" aria-label="Prospector home" className="flex items-center gap-3 overflow-hidden rounded-2xl px-3 py-3 transition-colors hover:bg-sidebar-accent">
            <StatusDot tone={agentTone} live={status.agent === "ONLINE" || status.agent === "RUNNING"} />
            <span className="machine whitespace-nowrap text-ink-foreground opacity-0 transition-opacity duration-300 group-hover/nav:opacity-100">
              CBO OS
            </span>
          </Link>

          {NAV.map((item) => {
            const active = pathname.startsWith(item.to);
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "relative flex items-center gap-3 overflow-hidden rounded-2xl px-3 py-2.5 transition-colors duration-300",
                  active ? "bg-sidebar-accent" : "hover:bg-white/5",
                )}
              >
                <span
                  className={cn(
                    "w-[10px] shrink-0 text-center text-[13px] leading-none transition-colors",
                    active ? "text-cyan" : "text-ink-foreground/40",
                  )}
                >
                  {item.glyph}
                </span>
                <span
                  className={cn(
                    "display whitespace-nowrap text-[13px] opacity-0 transition-opacity duration-300 group-hover/nav:opacity-100",
                    active ? "text-ink-foreground" : "text-ink-foreground/60",
                  )}
                >
                  {item.label}
                </span>
                {active && (
                  <span className="absolute right-2 h-1.5 w-1.5 rounded-full bg-cyan opacity-0 transition-opacity duration-300 group-hover/nav:opacity-100" />
                )}
              </Link>
            );
          })}

          <div className="mt-1 space-y-1 overflow-hidden rounded-2xl border-t border-sidebar-border px-3 pb-1 pt-3">
            <div className="machine flex items-center gap-2 whitespace-nowrap text-ink-foreground/55">
              <StatusDot tone={agentTone} live />
              <span className="opacity-0 transition-opacity duration-300 group-hover/nav:opacity-100">
                AGENT: {status.agent}
              </span>
            </div>
            <div className="machine whitespace-nowrap text-ink-foreground/40 opacity-0 transition-opacity duration-300 group-hover/nav:opacity-100">
              LAST RUN: {clockTime(status.lastRunAt)}
            </div>
            <div className="machine whitespace-nowrap text-ink-foreground/40 opacity-0 transition-opacity duration-300 group-hover/nav:opacity-100">
              DB: {status.db}
            </div>
          </div>
        </div>
      </nav>

      {/* TOP — context island + action island */}
      <header className="fixed inset-x-3 top-3 z-40 flex items-center justify-between gap-3 md:left-[92px] md:right-5 md:top-4">
        <div className="relative min-w-0">
          <button
            type="button"
            onClick={() => setContextOpen((v) => !v)}
            aria-expanded={contextOpen}
            aria-haspopup="menu"
            className="island-ink flex min-w-0 items-center gap-3 rounded-full py-2 pl-3 pr-4 transition-colors hover:bg-sidebar-accent"
          >
            <StatusDot tone={agentTone} live={status.agent === "ONLINE" || status.agent === "RUNNING"} />
            <span className="machine hidden text-ink-foreground/45 sm:inline">CONTEXT</span>
            <span className="display truncate text-[13px] text-ink-foreground">{context}</span>
            {approvals.length > 0 && (
              <span className="machine hidden items-center gap-1.5 rounded-full bg-warn-soft px-2 py-1 text-warn md:inline-flex">
                {approvals.length} AWAITING
              </span>
            )}
            <span
              className={cn(
                "text-[10px] text-ink-foreground/50 transition-transform duration-300",
                contextOpen && "rotate-180",
              )}
              aria-hidden="true"
            >
              ▾
            </span>
          </button>

          {contextOpen && (
            <div
              role="menu"
              className="island-ink rise absolute left-0 top-[calc(100%+8px)] z-50 w-[320px] overflow-hidden rounded-2xl p-1.5"
            >
              <div className="machine px-3 py-2 text-ink-foreground/45">
                {endeavours.length} ACTIVE {endeavours.length === 1 ? "ENDEAVOUR" : "ENDEAVOURS"}
              </div>
              {endeavours.length === 0 && (
                <Link
                  to="/endeavours"
                  onClick={() => setContextOpen(false)}
                  className="machine block rounded-xl px-3 py-3 text-ink-foreground/60 hover:bg-sidebar-accent"
                >
                  NO ACTIVE ENDEAVOURS — DEFINE ONE
                </Link>
              )}
              {/* Source: Endeavour state */}
              {endeavours.map((e) => (
                <Link
                  key={e.id}
                  to="/endeavours/$id"
                  params={{ id: e.id }}
                  onClick={() => setContextOpen(false)}
                  className="flex items-start justify-between gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-sidebar-accent"
                >
                  <span className="min-w-0">
                    <span className="display block truncate text-[13px] text-ink-foreground">{e.name}</span>
                    <span className="machine mt-1 block truncate text-ink-foreground/45">{e.nextCriticalAction}</span>
                  </span>
                  <span
                    className={cn(
                      "machine shrink-0 pt-0.5",
                      e.health === "ON_TRACK" ? "text-cyan" : e.health === "PAUSED" ? "text-ink-foreground/40" : "text-warn",
                    )}
                  >
                    {e.health.replace("_", " ")}
                  </span>
                </Link>
              ))}
              <Link
                to="/endeavours"
                onClick={() => setContextOpen(false)}
                className="machine mt-1 block border-t border-sidebar-border px-3 py-2.5 text-ink-foreground/55 hover:text-ink-foreground"
              >
                VIEW ALL ENDEAVOURS ↗
              </Link>
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <button
            onClick={() => setPaletteOpen(true)}
            className="machine island hidden h-9 items-center gap-8 rounded-full px-4 transition-colors hover:text-foreground md:flex"
          >
            SEARCH / COMMAND <span className="text-foreground/30">⌘K</span>
          </button>
          <Button
            variant="primary"
            size="md"
            className="h-9 rounded-full px-4"
            disabled={running}
            onClick={startRun}
            title="Trigger the daily execution loop now: research new prospects, qualify them, draft outreach and follow-ups for approval — instead of waiting for the next scheduled run."
          >
            {running ? "RUNNING…" : "RUN NOW"}
          </Button>
        </div>
      </header>

      {/* RUN STATE — visible progress of the manually triggered execution loop.
          Source: run trigger state (src/data/store.ts) */}
      {run.phase !== "IDLE" && (
        <div className="fixed inset-x-3 top-[62px] z-40 flex justify-end md:left-[92px] md:right-5 md:top-[72px]">
          <div className="island-ink rise flex max-w-full items-center gap-3 rounded-full px-4 py-2">
            <StatusDot tone={run.phase === "DONE" ? "idle" : "ok"} live={running} />
            <span className="machine text-ink-foreground/45">EXECUTION LOOP</span>
            <span className="machine text-ink-foreground">
              {run.phase === "RESEARCH" && "RESEARCHING PROSPECTS"}
              {run.phase === "QUALIFY" && "QUALIFYING"}
              {run.phase === "DRAFT" && "DRAFTING OUTREACH"}
              {run.phase === "QUEUE" && "QUEUEING FOR APPROVAL"}
              {run.phase === "DONE" && run.note}
            </span>
            {run.phase === "DONE" && (
              <button
                type="button"
                onClick={dismissRun}
                className="machine text-ink-foreground/50 transition-colors hover:text-ink-foreground"
              >
                DISMISS
              </button>
            )}
          </div>
        </div>
      )}

      {/* MOBILE NAV — compact island */}
      <nav className="island-ink fixed inset-x-3 bottom-3 z-40 flex items-center justify-between gap-1 overflow-x-auto rounded-full px-2 py-2 md:hidden">
        {NAV.map((item) => {
          const active = pathname.startsWith(item.to);
          return (
            <Link
              key={item.to}
              to={item.to}
              aria-label={item.label}
              className={cn(
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[13px]",
                active ? "bg-sidebar-accent text-cyan" : "text-ink-foreground/50",
              )}
            >
              {item.glyph}
            </Link>
          );
        })}
      </nav>

      {/* CONTENT SURFACE — floats above the world */}
      <main className="relative z-10 px-3 pb-20 pt-[72px] md:pb-10 md:pl-[92px] md:pr-5 md:pt-[76px]">
        <div key={pathname} className="rise">
          {children}
        </div>
      </main>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}
