import type { PreferenceValue, ShiftCode } from "../shifts/shift-type";
import { preferenceFit, type PreferenceFit } from "./preference-fit";

/**
 * How one day's assignments relate to the nurses' own wishes, for the Head
 * Nurse while scheduling. Built only from `preferenceFit` (D50): advisory
 * context, never a rule. No count here is a violation, and none of them
 * blocks FINALIZE or SUBMIT (D35, D48).
 *
 * Two independent dimensions of the same roster:
 *
 * 1. Fit (a partition: every rostered nurse is in exactly one of these, so
 *    `matches + differs + pending + noPreference === rostered`):
 *    - matches: the assigned shift is the wished one;
 *    - differs: a shift is assigned and it is not the wished one (a rest
 *      wish with any shift included);
 *    - pending: a preference (a shift or OFF) is recorded and there is no
 *      assignment yet; OFF is never a match by the mere absence of a shift
 *      (D99);
 *    - noPreference: nothing recorded for the day ("no preference" is the
 *      absence of a row, D35; an explicit OFF is a recorded preference).
 * 2. Assignment: `unassigned` counts nurses without a shift that day. It
 *    overlaps `pending` and `noPreference`, so it must never be added to the
 *    fit counts.
 */
export interface PreferenceAlignment {
  /** Everyone on the roster for the day. */
  readonly rostered: number;
  /** Nurses with a recorded preference (a shift or OFF). */
  readonly withPreference: number;
  readonly matches: number;
  readonly differs: number;
  readonly pending: number;
  readonly noPreference: number;
  /** Nurses without a shift that day (overlaps the fit counts). */
  readonly unassigned: number;
}

export interface AlignmentInput {
  readonly preference: PreferenceValue | null;
  readonly shift: ShiftCode | null;
}

export function summarizePreferenceAlignment(
  nurses: readonly AlignmentInput[],
): PreferenceAlignment {
  const fits: Record<PreferenceFit, number> = {
    NONE: 0,
    MATCHES: 0,
    DIFFERS: 0,
    PENDING: 0,
  };
  let unassigned = 0;
  for (const { preference, shift } of nurses) {
    fits[preferenceFit(preference, shift)] += 1;
    if (shift === null) unassigned += 1;
  }
  return {
    rostered: nurses.length,
    withPreference: nurses.length - fits.NONE,
    matches: fits.MATCHES,
    differs: fits.DIFFERS,
    pending: fits.PENDING,
    noPreference: fits.NONE,
    unassigned,
  };
}

/** The assignment conflicts with a recorded preference (the «فقط مغایر ترجیح» filter). */
export const conflictsWithPreference = (input: AlignmentInput): boolean =>
  preferenceFit(input.preference, input.shift) === "DIFFERS";
