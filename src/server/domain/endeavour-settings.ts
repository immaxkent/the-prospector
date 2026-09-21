/**
 * Per-endeavour operating settings: how it paces itself, not what it is trying to achieve.
 *
 * These are separate from the spec on purpose. The spec is the commercial contract and every
 * change to it is a new version with a reason; these are dials an operator turns while watching
 * results, and turning one should not create a strategy revision.
 */
import { DEFAULT_PACING, normalisePacing, type PacingSettings } from "./pacing";
import { DEFAULT_FOLLOWUP_DAYS } from "./followup";

export interface EndeavourSettings {
  pacing: PacingSettings;
  /** Days after the last outbound to try again, in order. An empty list means never follow up. */
  followUpDays: number[];
}

export const DEFAULT_ENDEAVOUR_SETTINGS: EndeavourSettings = {
  pacing: DEFAULT_PACING,
  followUpDays: [...DEFAULT_FOLLOWUP_DAYS],
};

export const MAX_FOLLOW_UPS = 6;
export const MAX_FOLLOW_UP_DAY = 180;

/**
 * Follow-up days must climb: two gaps of the same length read as an automated sequence, and a
 * gap that shrinks reads as pestering. Out-of-order input is sorted rather than refused.
 */
export function normaliseFollowUpDays(days: readonly number[] | null | undefined): number[] {
  if (!days) return [...DEFAULT_FOLLOWUP_DAYS];
  const cleaned = [...new Set(days.map((d) => Math.round(d)).filter((d) => Number.isFinite(d) && d >= 1 && d <= MAX_FOLLOW_UP_DAY))];
  return cleaned.sort((a, b) => a - b).slice(0, MAX_FOLLOW_UPS);
}

export function normaliseSettings(stored: Partial<EndeavourSettings> | null | undefined): EndeavourSettings {
  return {
    pacing: normalisePacing(stored?.pacing),
    followUpDays: normaliseFollowUpDays(stored?.followUpDays),
  };
}
