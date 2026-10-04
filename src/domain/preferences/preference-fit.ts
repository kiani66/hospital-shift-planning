import type { PreferenceValue, ShiftCode } from "../shifts/shift-type";

/**
 * How a nurse's own wish for a day relates to their assignment, for the
 * Head Nurse while scheduling. Preferences are wishes, not constraints (D35):
 * none of these states is a violation, and `DIFFERS` never blocks anything.
 *
 * - NONE: no preference was entered.
 * - MATCHES: the assigned shift is the wished one.
 * - DIFFERS: the nurse has a shift that is not the one wished (a rest wish
 *   with any shift included).
 * - PENDING: a preference is recorded and no assignment decision exists yet.
 *
 * OFF follows the same lifecycle as a shift wish (D99, amends D50): without
 * an assignment row it is PENDING, never MATCHES. The working copy has no way
 * to record an explicit "this nurse is off" decision (no row is both "off"
 * and "not planned yet"), so absence is never read as that decision.
 */
export type PreferenceFit = "NONE" | "MATCHES" | "DIFFERS" | "PENDING";

export function preferenceFit(
  preference: PreferenceValue | null,
  assignment: ShiftCode | null,
): PreferenceFit {
  if (preference === null) return "NONE";
  if (assignment === null) return "PENDING";
  return preference === assignment ? "MATCHES" : "DIFFERS";
}
