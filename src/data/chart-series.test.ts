import { describe, expect, it } from "vitest";
import type { Thread } from "./types";
import { dailyActivity, isQuiet } from "./chart-series";

const NOW = new Date("2026-09-27T12:00:00Z");

const thread = (messages: Partial<Thread["messages"][number]>[]): Thread =>
  ({ id: "t1", prospectId: "p1", endeavourId: "e1", unread: false, messages }) as Thread;

const sentOn = (day: string) => ({ author: "AGENT" as const, sendState: "sent" as const, sentAt: `${day}T09:00:00Z` });
const repliedOn = (day: string) => ({ author: "PROSPECT" as const, sendState: null, sentAt: `${day}T15:00:00Z` });

describe("dailyActivity", () => {
  it("returns one entry per day, oldest first, ending today", () => {
    const days = dailyActivity([], NOW, 14);
    expect(days).toHaveLength(14);
    expect(days[0]!.date).toBe("2026-09-14");
    expect(days[13]!.date).toBe("2026-09-27");
  });

  it("keeps empty days, so a quiet week is not drawn as a straight climb", () => {
    const days = dailyActivity([thread([sentOn("2026-09-20")])], NOW, 14);
    expect(days).toHaveLength(14);
    expect(days.filter((d) => d.sent === 0)).toHaveLength(13);
  });

  it("counts sends and replies into their own day", () => {
    const days = dailyActivity([thread([sentOn("2026-09-25"), repliedOn("2026-09-26")])], NOW, 14);
    expect(days.find((d) => d.date === "2026-09-25")).toEqual({ date: "2026-09-25", sent: 1, replies: 0 });
    expect(days.find((d) => d.date === "2026-09-26")).toEqual({ date: "2026-09-26", sent: 0, replies: 1 });
  });

  it("adds up several messages on one day, across threads", () => {
    const days = dailyActivity(
      [thread([sentOn("2026-09-25"), sentOn("2026-09-25")]), thread([sentOn("2026-09-25"), repliedOn("2026-09-25")])],
      NOW,
      14,
    );
    expect(days.find((d) => d.date === "2026-09-25")).toEqual({ date: "2026-09-25", sent: 3, replies: 1 });
  });

  it("counts a message as sent only once it has been sent", () => {
    const queued = { author: "AGENT" as const, sendState: "queued" as const, sentAt: "2026-09-25T09:00:00Z" };
    const days = dailyActivity([thread([queued, sentOn("2026-09-25")])], NOW, 14);
    expect(days.find((d) => d.date === "2026-09-25")!.sent).toBe(1);
  });

  it("drops anything older than the window rather than piling it onto the first day", () => {
    const days = dailyActivity([thread([sentOn("2026-01-01"), sentOn("2026-09-14")])], NOW, 14);
    expect(days[0]).toEqual({ date: "2026-09-14", sent: 1, replies: 0 });
    expect(days.reduce((n, d) => n + d.sent, 0)).toBe(1);
  });

  it("ignores a message with no timestamp instead of throwing", () => {
    const orphan = { author: "AGENT" as const, sendState: "sent" as const, sentAt: "" };
    expect(() => dailyActivity([thread([orphan])], NOW, 14)).not.toThrow();
    expect(dailyActivity([thread([orphan])], NOW, 14).reduce((n, d) => n + d.sent, 0)).toBe(0);
  });

  it("honours a shorter window", () => {
    const days = dailyActivity([], NOW, 7);
    expect(days).toHaveLength(7);
    expect(days[0]!.date).toBe("2026-09-21");
  });
});

describe("isQuiet", () => {
  it("is true when nothing happened in the window", () => {
    expect(isQuiet(dailyActivity([], NOW, 14))).toBe(true);
  });

  it("is false as soon as anything did", () => {
    expect(isQuiet(dailyActivity([thread([repliedOn("2026-09-26")])], NOW, 14))).toBe(false);
  });
});
