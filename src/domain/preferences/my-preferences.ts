import type { IsoDate } from "../shared/dates";
import { allow, deny, type Decision } from "../shared/decision";
import type { PreferenceValue } from "../shifts/shift-type";
import {
  canEditPreference,
  type PreferenceEditContext,
  type PreferenceEditDenial,
} from "./can-edit-preference";
import { windowCovers, type PreferenceWindow } from "./preference-window";

/**
 * The nurse-facing view of preference windows. Preferences are wishes, not
 * assignments: nothing here applies assignment rules (night rest, coverage)
 * to them.
 */

/** Windows whose nurse scope includes the nurse (open or closed). */
export const windowsForNurse = <W extends PreferenceWindow>(
  windows: readonly W[],
  nurseId: string,
): W[] =>
  windows.filter((w) => w.nurseIds.size === 0 || w.nurseIds.has(nurseId));

/**
 * Why a nurse may not edit their preference for one day, precise enough to
 * explain it: the domain's NO_ACTIVE_WINDOW is split into WINDOW_CLOSED (a
 * window covered the day but is closed or past its deadline) and
 * DATE_NOT_IN_WINDOW (no window for this nurse ever covered it).
 */
export type PreferenceDayLock =
  | Exclude<PreferenceEditDenial, "NO_ACTIVE_WINDOW">
  | "WINDOW_CLOSED"
  | "DATE_NOT_IN_WINDOW";

export function preferenceDayAccess(
  ctx: PreferenceEditContext,
): Decision<PreferenceDayLock> {
  const decision = canEditPreference(ctx);
  if (decision.allowed) return allow;
  if (decision.reason !== "NO_ACTIVE_WINDOW") return deny(decision.reason);
  return ctx.windows.some((w) => windowCovers(w, ctx.nurseId, ctx.date))
    ? deny("WINDOW_CLOSED")
    : deny("DATE_NOT_IN_WINDOW");
}

export type PreferenceSummary = Readonly<
  Record<PreferenceValue, number> & { total: number }
>;

/** How many days carry each preference (informational; not workload). */
export function summarizePreferences(
  values: Iterable<PreferenceValue>,
): PreferenceSummary {
  const summary = { M: 0, E: 0, N: 0, ME: 0, OFF: 0, total: 0 };
  for (const value of values) {
    summary[value] += 1;
    summary.total += 1;
  }
  return summary;
}

/** Every date any of the windows covers, for display of the allowed range. */
export const windowDates = (
  windows: readonly PreferenceWindow[],
): Set<IsoDate> => new Set(windows.flatMap((w) => [...w.dates]));
