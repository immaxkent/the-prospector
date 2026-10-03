/**
 * The stages of an endeavour, in the order the work happens.
 *
 * One list, used by the page and by the rail. They disagreed before — the rail named the
 * sections and the page laid them out, and keeping two orderings in step was a thing
 * nobody was doing.
 *
 * The order is the work: find them, decide which are leads, find the human, write, talk,
 * close. What came before was the order of the data model, which is why the stage that
 * produced everything else — research — was not on the page at all.
 */
export interface EndeavourSection {
  id: string;
  label: string;
  /** False while the stage is planned but not written. The page and the rail both say so. */
  built: boolean;
  /** One line on what it will do. Shown where the stage would be. */
  what?: string;
}

export const ENDEAVOUR_SECTIONS: readonly EndeavourSection[] = [
  { id: "overview", label: "OVERVIEW", built: true },
  { id: "research", label: "RESEARCH", built: true },
  { id: "identify", label: "IDENTIFY", built: true },
  {
    id: "reach",
    label: "REACH",
    built: false,
    what: "Who the human is and every way to reach them — email, LinkedIn, Discord, Slack — with where each came from.",
  },
  { id: "outreach", label: "OUTREACH", built: true },
  {
    id: "conversations",
    label: "CONVERSATIONS",
    built: false,
    what: "Replies attributed to the outreach that caused them, in one thread per prospect, whichever channel they arrived on.",
  },
  { id: "deals", label: "DEALS", built: true },
  { id: "strategy", label: "STRATEGY", built: true },
  { id: "configuration", label: "CONFIGURATION", built: true },
  { id: "runs", label: "RUNS", built: true },
];

export const SECTION_IDS = ENDEAVOUR_SECTIONS.map((s) => s.id);
