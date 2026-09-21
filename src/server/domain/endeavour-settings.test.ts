import { describe, expect, it } from "vitest";
import { DEFAULT_PACING } from "./pacing";
import {
  DEFAULT_ENDEAVOUR_SETTINGS,
  MAX_FOLLOW_UPS,
  normaliseFollowUpDays,
  normaliseSettings,
} from "./endeavour-settings";

describe("normaliseFollowUpDays", () => {
  it("defaults to three, seven and fourteen days", () => {
    expect(normaliseFollowUpDays(null)).toEqual([3, 7, 14]);
    expect(DEFAULT_ENDEAVOUR_SETTINGS.followUpDays).toEqual([3, 7, 14]);
  });

  it("sorts them so the gaps grow rather than shrink", () => {
    expect(normaliseFollowUpDays([14, 3, 7])).toEqual([3, 7, 14]);
  });

  it("drops duplicates, so two follow-ups never land on the same day", () => {
    expect(normaliseFollowUpDays([3, 3, 7])).toEqual([3, 7]);
  });

  it("refuses same-day and absurdly distant follow-ups", () => {
    expect(normaliseFollowUpDays([0, 3, 400])).toEqual([3]);
    expect(normaliseFollowUpDays([-2])).toEqual([]);
  });

  it("caps how many times one prospect can be chased", () => {
    expect(normaliseFollowUpDays([1, 2, 3, 4, 5, 6, 7, 8, 9])).toHaveLength(MAX_FOLLOW_UPS);
  });

  it("accepts an empty list, meaning never follow up", () => {
    expect(normaliseFollowUpDays([])).toEqual([]);
  });
});

describe("normaliseSettings", () => {
  it("fills in everything an endeavour has not chosen", () => {
    expect(normaliseSettings({})).toEqual(DEFAULT_ENDEAVOUR_SETTINGS);
    expect(normaliseSettings(null)).toEqual(DEFAULT_ENDEAVOUR_SETTINGS);
  });

  it("keeps a partial choice and defaults the rest", () => {
    const settings = normaliseSettings({ pacing: { ...DEFAULT_PACING, minGapMinutes: 12, maxGapMinutes: 40 } });
    expect(settings.pacing).toMatchObject({ minGapMinutes: 12, maxGapMinutes: 40, window: DEFAULT_PACING.window });
    expect(settings.followUpDays).toEqual([3, 7, 14]);
  });
});
