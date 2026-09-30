/**
 * DESIGN FIXTURES ONLY. Keeps the demo dataset's story where it was written: relative to
 * the day you are reading it.
 *
 * The fixtures tell a ten-day story and were authored against one day, the anchor below.
 * Left as literals they age, and one of the screens reads them through a window: the
 * activity chart covers the last fortnight. On the fourteenth day after the last fixture
 * message that window empties and the endeavour says nothing has gone out in a fortnight
 * — which is what happened on 2026-09-30, on a chart that had been right the day before,
 * and which failed a test that had passed for a fortnight.
 *
 * So every date in the fixtures is written as it was authored and shifted to today. Past
 * stays the same distance behind, future the same distance ahead, and the story keeps its
 * shape whatever day it is read on.
 *
 * Whole days, never hours: the fixtures say things like 07:32, and a story about a run
 * that happened at half seven should still read half seven tomorrow.
 *
 * The shift is applied when the module loads, so it is the day the process started. Every
 * deploy re-anchors it. A demo server left running for a fortnight would drift again —
 * worth knowing, and cheap to fix by restarting it.
 */

/** The day the fixture literals were written against. */
export const FIXTURE_ANCHOR = "2026-09-16";

const DAY = 86_400_000;

/** Whole days from the anchor to `now`, in UTC, so a time of day cannot round it either way. */
export function fixtureOffsetDays(now: Date, anchor = FIXTURE_ANCHOR): number {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((today - Date.parse(anchor)) / DAY);
}

/**
 * Moves one fixture date forward by the offset, keeping its shape.
 *
 * The time of day is carried across as written rather than re-formatted, so a `Z` stays a
 * `Z` and a date with no time stays a date with no time.
 */
export function shiftFixtureDate(iso: string, now = new Date()): string {
  const days = fixtureOffsetDays(now);
  const split = iso.indexOf("T");
  const datePart = split === -1 ? iso : iso.slice(0, split);
  const timePart = split === -1 ? "" : iso.slice(split);
  const shifted = new Date(Date.parse(datePart) + days * DAY).toISOString().slice(0, 10);
  return `${shifted}${timePart}`;
}
