import { describe, expect, it } from "vitest";
import {
  DEFAULT_PACING,
  earliestReplyAt,
  hourIn,
  isKnownTimezone,
  jitteredGapMs,
  nextSlot,
  nextWindowOpening,
  normalisePacing,
  withinWindow,
  type PacingSettings,
} from "./pacing";

const LONDON = "Europe/London";
const NEW_YORK = "America/New_York";
const pacing: PacingSettings = { ...DEFAULT_PACING, minGapMinutes: 10, maxGapMinutes: 10 };
/** Always the midpoint, so a jittered gap is predictable in tests. */
const fixed = () => 0.5;

describe("normalisePacing", () => {
  it("fills in what is missing and keeps what is given", () => {
    expect(normalisePacing({ minGapMinutes: 7 })).toMatchObject({ minGapMinutes: 7, maxGapMinutes: 25 });
    expect(normalisePacing(null)).toEqual(DEFAULT_PACING);
  });

  it("restores the default window when one would never open", () => {
    expect(normalisePacing({ window: { startHour: 18, endHour: 9 } }).window).toEqual(DEFAULT_PACING.window);
    expect(normalisePacing({ window: { startHour: 9, endHour: 9 } }).window).toEqual(DEFAULT_PACING.window);
  });

  it("never lets the maximum gap fall below the minimum", () => {
    expect(normalisePacing({ minGapMinutes: 30, maxGapMinutes: 5 })).toMatchObject({ minGapMinutes: 30, maxGapMinutes: 30 });
  });

  it("keeps gaps and delays inside sane bounds", () => {
    expect(normalisePacing({ minGapMinutes: 0 }).minGapMinutes).toBe(1);
    expect(normalisePacing({ minGapMinutes: 9999, maxGapMinutes: 9999 }).maxGapMinutes).toBe(240);
    expect(normalisePacing({ minReplyDelayMinutes: -5 }).minReplyDelayMinutes).toBe(0);
  });
});

describe("timezones", () => {
  it("reads the local hour, and falls back to UTC for a name it does not know", () => {
    const at = new Date("2026-09-21T15:30:00Z");
    expect(hourIn(at, LONDON)).toBe(16); // BST
    expect(hourIn(at, NEW_YORK)).toBe(11);
    expect(hourIn(at, "Mars/Olympus")).toBe(15);
  });

  it("recognises a real timezone and rejects nonsense", () => {
    expect(isKnownTimezone(LONDON)).toBe(true);
    expect(isKnownTimezone("Mars/Olympus")).toBe(false);
    expect(isKnownTimezone(null)).toBe(false);
    expect(isKnownTimezone("")).toBe(false);
  });
});

describe("the sending window", () => {
  const window = { startHour: 8, endHour: 17 };

  it("knows whether a moment is inside it, in the right timezone", () => {
    const at = new Date("2026-09-21T15:00:00Z"); // 16:00 London, 11:00 New York
    expect(withinWindow(at, LONDON, window)).toBe(true);
    expect(withinWindow(at, NEW_YORK, window)).toBe(true);
    const evening = new Date("2026-09-21T21:00:00Z"); // 22:00 London, 17:00 New York
    expect(withinWindow(evening, LONDON, window)).toBe(false);
    expect(withinWindow(evening, NEW_YORK, window)).toBe(false); // endHour is exclusive
  });

  it("waits until the window opens again rather than sending at night", () => {
    const at = new Date("2026-09-21T22:30:00Z"); // 23:30 London
    const opened = nextWindowOpening(at, LONDON, window);
    expect(hourIn(opened, LONDON)).toBe(8);
    expect(opened.toISOString().slice(0, 10)).toBe("2026-09-22");
  });

  it("leaves a moment already inside the window alone", () => {
    const at = new Date("2026-09-21T09:13:00Z");
    expect(nextWindowOpening(at, LONDON, window)).toEqual(at);
  });
});

describe("jitteredGapMs", () => {
  it("stays between the bounds", () => {
    const spread = { ...DEFAULT_PACING, minGapMinutes: 4, maxGapMinutes: 25 };
    for (const r of [0, 0.5, 0.999]) {
      const minutes = jitteredGapMs(spread, () => r) / 60_000;
      expect(minutes).toBeGreaterThanOrEqual(4);
      expect(minutes).toBeLessThanOrEqual(25);
    }
  });

  it("does not return the same gap for different draws", () => {
    const spread = { ...DEFAULT_PACING, minGapMinutes: 4, maxGapMinutes: 25 };
    expect(jitteredGapMs(spread, () => 0)).not.toBe(jitteredGapMs(spread, () => 0.99));
  });
});

describe("nextSlot", () => {
  const base = {
    earliest: new Date("2026-09-21T09:00:00Z"), // 10:00 London
    previousSlot: null,
    recipientTimezone: null,
    mailboxTimezone: LONDON,
    pacing,
    random: fixed,
  };

  it("sends now when nothing is queued and the window is open", () => {
    expect(nextSlot(base)).toMatchObject({ at: base.earliest, timeZone: LONDON, usedRecipientTimezone: false });
  });

  it("spaces a message from the one before it", () => {
    const slot = nextSlot({ ...base, previousSlot: new Date("2026-09-21T09:05:00Z") });
    expect(slot.at.toISOString()).toBe("2026-09-21T09:15:00.000Z");
  });

  it("uses the recipient's morning when their timezone is known", () => {
    // 09:00 UTC is 05:00 in New York: too early there, so it waits for 08:00 local.
    const slot = nextSlot({ ...base, recipientTimezone: NEW_YORK });
    expect(slot.usedRecipientTimezone).toBe(true);
    expect(hourIn(slot.at, NEW_YORK)).toBe(8);
  });

  it("falls back to the mailbox when the recipient's timezone is unknown or switched off", () => {
    expect(nextSlot({ ...base, recipientTimezone: "Mars/Olympus" })).toMatchObject({ timeZone: LONDON, usedRecipientTimezone: false });
    expect(
      nextSlot({ ...base, recipientTimezone: NEW_YORK, pacing: { ...pacing, useRecipientTimezone: false } }),
    ).toMatchObject({ timeZone: LONDON, usedRecipientTimezone: false });
  });

  it("pushes a late arrival to the next morning rather than sending at night", () => {
    const slot = nextSlot({ ...base, earliest: new Date("2026-09-21T21:40:00Z") }); // 22:40 London
    expect(hourIn(slot.at, LONDON)).toBe(8);
    expect(slot.at.getTime()).toBeGreaterThan(new Date("2026-09-21T21:40:00Z").getTime());
  });

  it("never schedules before the earliest allowed moment, even when the queue is empty", () => {
    const earliest = new Date("2026-09-21T14:00:00Z");
    const slot = nextSlot({ ...base, earliest, previousSlot: new Date("2026-09-21T08:00:00Z") });
    expect(slot.at.getTime()).toBeGreaterThanOrEqual(earliest.getTime());
  });
});

describe("earliestReplyAt", () => {
  const now = new Date("2026-09-21T09:00:00Z");

  it("holds a reply back so it does not arrive seconds after theirs", () => {
    const inbound = new Date("2026-09-21T08:45:00Z");
    expect(earliestReplyAt(inbound, now, DEFAULT_PACING).toISOString()).toBe("2026-09-21T10:15:00.000Z");
  });

  it("does not delay a reply to something that arrived long ago", () => {
    expect(earliestReplyAt(new Date("2026-09-20T08:00:00Z"), now, DEFAULT_PACING)).toEqual(now);
  });

  it("has nothing to hold back when there is no inbound message", () => {
    expect(earliestReplyAt(null, now, DEFAULT_PACING)).toEqual(now);
  });
});
