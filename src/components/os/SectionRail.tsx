import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

export interface Section {
  id: string;
  label: string;
}

/**
 * Which section the reader is currently in.
 *
 * The topmost visible section wins rather than the most visible one: while scrolling down
 * through a long section the heading that has just passed the top of the screen is the one
 * the reader is under, and picking by area would flicker between two sections whenever a
 * short one is fully on screen beside a long one.
 */
export function useSectionSpy(ids: readonly string[]) {
  const [active, setActive] = useState(ids[0] ?? "");

  useEffect(() => {
    const seen = new Map<string, boolean>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) seen.set(entry.target.id, entry.isIntersecting);
        const first = ids.find((id) => seen.get(id));
        // Past the last section nothing intersects; the reader is still in the last one.
        if (first) setActive(first);
      },
      // The band starts below the sticky header and ends well above the fold, so a section
      // becomes current as its heading arrives rather than as its last line leaves.
      { rootMargin: "-88px 0px -55% 0px", threshold: 0 },
    );

    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [ids]);

  return active;
}

/**
 * The section list, as a rail on the right.
 *
 * It mirrors the app's left rail deliberately: same island, same widen-on-hover. One is
 * where you are in the system, the other where you are in the page, and a reader who has
 * learnt the first gets the second for free.
 */
export function SectionRail({ sections, active }: { sections: readonly Section[]; active: string }) {
  return (
    <nav
      aria-label="Sections"
      data-testid="section-rail"
      className="group/sections fixed right-4 top-1/2 z-40 hidden -translate-y-1/2 xl:block"
    >
      <div className="island-ink flex w-[58px] flex-col gap-1 rounded-3xl p-2 transition-[width] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover/sections:w-[190px]">
        {sections.map((section) => {
          const on = section.id === active;
          return (
            <a
              key={section.id}
              href={`#${section.id}`}
              aria-current={on ? "true" : undefined}
              className={cn(
                "flex items-center gap-3 overflow-hidden rounded-2xl px-3 py-2.5 transition-colors duration-300",
                on ? "bg-sidebar-accent" : "hover:bg-white/5",
              )}
            >
              {/* Collapsed, the rail is a row of ticks — the current one long and lit. */}
              <span
                aria-hidden="true"
                className={cn(
                  "h-[2px] shrink-0 rounded-full transition-all duration-300",
                  on ? "w-5 bg-signal" : "w-3 bg-foreground/25 group-hover/sections:bg-foreground/40",
                )}
              />
              <span
                className={cn(
                  "machine whitespace-nowrap opacity-0 transition-opacity duration-300 group-hover/sections:opacity-100",
                  on ? "text-foreground" : "text-ink-foreground",
                )}
              >
                {section.label}
              </span>
            </a>
          );
        })}
      </div>
    </nav>
  );
}
