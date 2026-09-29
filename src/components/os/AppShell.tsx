import { Link, useRouterState } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { StatusDot } from "./primitives";
import { CommandPalette } from "./CommandPalette";
import { WorldCanvas } from "@/components/world/WorldCanvas";
import { useDataset, initDataMode } from "@/data/store";
import { clockTime } from "@/lib/format";
import { useSwipeNav } from "@/hooks/use-swipe-nav";

/** Nav order doubles as the station order in the 3D world. */
/*
 * Interfaces is not listed. It describes an event seam nothing consumes yet: this app's own
 * API, and two external systems named in the original handoff that have never sent or
 * received anything. A permanent nav entry for a screen that is all zeroes teaches the
 * reader to skip a row, and the route still answers for anyone who wants it.
 */
const NAV: { to: string; label: string; key: string; glyph: string }[] = [
  { to: "/command", label: "Command", key: "01", glyph: "◈" },
  { to: "/endeavours", label: "Endeavours", key: "02", glyph: "◆" },
  // An endeavour's whole output is conversations, so the mailbox sits directly under it.
  { to: "/mailbox", label: "Mailbox", key: "03", glyph: "✉" },
  { to: "/prospects", label: "Prospects", key: "04", glyph: "▤" },
  { to: "/pipeline", label: "Pipeline", key: "05", glyph: "▥" },
  { to: "/research", label: "Research", key: "06", glyph: "◎" },
  { to: "/intelligence", label: "Intelligence", key: "07", glyph: "✦" },
  { to: "/settings", label: "Settings", key: "08", glyph: "⚙" },
  { to: "/walkthroughs", label: "Walkthroughs", key: "09", glyph: "☰" },
];

export function AppShell({ children }: { children: ReactNode }) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const { status } = useDataset();
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


  const activeIndex = pathname === "/" ? 0 : Math.max(1, NAV.findIndex((n) => pathname.startsWith(n.to)) + 1);

  // Source: Endeavour state (first active endeavour is the working context)
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

      {/*
        The endeavour picker used to live here. It named the endeavour you were on while the
        page already said so, and offered a jump the left rail already offers — a permanent
        fixture earning its space once, on the screens where you were not already looking at
        an endeavour.
      */}
      <header className="fixed inset-x-3 top-3 z-40 flex items-center justify-end gap-3 md:left-[92px] md:right-5 md:top-4">
        <div className="flex shrink-0 items-center gap-2">
          <button
            onClick={() => setPaletteOpen(true)}
            className="machine island hidden h-9 items-center gap-8 rounded-full px-4 transition-colors hover:text-foreground md:flex"
          >
            SEARCH / COMMAND <span className="text-foreground/30">⌘K</span>
          </button>
        </div>
      </header>

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
