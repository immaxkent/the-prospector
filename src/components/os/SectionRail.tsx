import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

export interface Section {
  id: string;
  label: string;
}

/** Where the sticky header ends, and so where "the top of the page" is for a reader. */
const HEADER = 88;

/**
 * Which section the reader is currently in.
 *
 * Whole sections are watched, not their headings: a heading is one line tall, so it
 * crosses the band and leaves, and an anchor jump skips the headings in between entirely.
 * A section is always under the reader somewhere, so there is always an answer.
 */
export function useSectionSpy(ids: readonly string[]) {
  const [active, setActive] = useState(ids[0] ?? "");

  useEffect(() => {
    const elements = ids
      .map((id) => ({ id, el: document.querySelector(`[data-section="${id}"]`) }))
      .filter((s): s is { id: string; el: Element } => !!s.el);
    if (elements.length === 0) return;

    // The reader is in the last section that has begun above the header line. Asking the
    // observer which sections merely intersect is not enough: at a boundary the outgoing
    // section still overlaps the band by a few pixels and would keep winning.
    const pick = () => {
      // The page runs out before a short last section can reach the top, so by this rule
      // alone it could never become current. At the foot of the page you are in the last
      // section, whatever its top edge says.
      if (window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2) {
        setActive(elements[elements.length - 1]!.id);
        return;
      }
      let current = elements[0]!.id;
      for (const { id, el } of elements) {
        if (el.getBoundingClientRect().top <= HEADER + 1) current = id;
      }
      setActive(current);
    };

    // The observer is only the trigger — it fires exactly when a section crosses the band,
    // which is exactly when the answer can change.
    const observer = new IntersectionObserver(pick, { rootMargin: `-${HEADER}px 0px -60% 0px`, threshold: 0 });
    for (const { el } of elements) observer.observe(el);
    // The foot-of-page rule turns on a scroll position no section crossing reports, so the
    // observer alone would not fire for it.
    window.addEventListener("scroll", pick, { passive: true });
    pick();
    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", pick);
    };
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
