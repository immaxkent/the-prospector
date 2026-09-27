/**
 * Turning what the dataset holds into what a chart needs.
 *
 * Kept apart from the drawing so the arithmetic can be tested without rendering anything,
 * and so a chart cannot quietly invent a number while laying it out.
 */
import type { DayPoint } from "@/components/os/charts";
import type { Thread } from "./types";

const DAY = 86_400_000;

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Messages sent and replies received, one entry per day, oldest first.
 *
 * Every day in the window is present even when nothing happened: a line that skips its
 * empty days draws a quiet week as a straight climb, which is the opposite of what
 * happened. Days are counted in UTC, matching the timestamps the messages carry.
 */
export function dailyActivity(threads: readonly Thread[], now: Date, days = 14): DayPoint[] {
  const window = new Map<string, DayPoint>();
  for (let i = days - 1; i >= 0; i--) {
    const date = isoDay(new Date(now.getTime() - i * DAY));
    window.set(date, { date, sent: 0, replies: 0 });
  }

  for (const thread of threads) {
    for (const message of thread.messages) {
      if (!message.sentAt) continue;
      const day = window.get(message.sentAt.slice(0, 10));
      // Anything older than the window is not clamped into its first day, which would
      // show a spike on a day that had none.
      if (!day) continue;
      if (message.author === "PROSPECT") day.replies += 1;
      else if (message.sendState === "sent") day.sent += 1;
    }
  }

  return [...window.values()];
}

/** True when the window holds nothing at all, so a chart can say so rather than draw a flat line. */
export const isQuiet = (days: readonly DayPoint[]) => days.every((d) => d.sent === 0 && d.replies === 0);
