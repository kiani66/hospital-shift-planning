import type { PreferenceValue, ShiftCode } from "../shifts/shift-type";

/**
 * How a nurse's own wish for a day relates to their assignment, for the
 * Head Nurse while scheduling. Preferences are wishes, not constraints (D35):
 * none of these states is a violation, and `DIFFERS` never blocks anything.
 *
 * - NONE: no preference was entered.
 * - MATCHES: the assignment is the wished shift, or the nurse wished rest
 *   (OFF) and has no shift.
 * - DIFFERS: the nurse has a shift that is not the one wished (a rest wish
 *   with any shift included).
 * - PENDING: a shift is wished and the nurse has no shift yet.
 */
export type PreferenceFit = "NONE" | "MATCHES" | "DIFFERS" | "PENDING";

export function preferenceFit(
  preference: PreferenceValue | null,
  assignment: ShiftCode | null,
): PreferenceFit {
  if (preference === null) return "NONE";
  if (assignment === null) return preference === "OFF" ? "MATCHES" : "PENDING";
  return preference === assignment ? "MATCHES" : "DIFFERS";
}
