import type { IsoDate } from "../shared/dates";
import { ValidationError } from "../shared/errors";
import { err, ok, type Result } from "../shared/result";

/**
 * A period during which nurses may enter preferences. "Open preference
 * collection" is an INITIAL window covering the whole schedule period; a scoped
 * reopen is a REOPEN window for selected dates (and optionally selected nurses).
 */
export interface PreferenceWindow {
  readonly kind: "INITIAL" | "REOPEN";
  readonly dates: ReadonlySet<IsoDate>;
  /** Nurses the window is for; empty means everyone on the roster. */
  readonly nurseIds: ReadonlySet<string>;
  /** Optional deadline; the window closes itself at this instant. */
  readonly closesAt: Date | null;
  /** Set when the Head Nurse (or FINALIZE) closed the window. */
  readonly closedAt: Date | null;
}

/** Active = not closed and before its deadline (deadline evaluated lazily, no cron). */
export const isWindowActive = (window: PreferenceWindow, now: Date): boolean =>
  window.closedAt === null &&
  (window.closesAt === null || now.getTime() < window.closesAt.getTime());

export const windowCovers = (
  window: PreferenceWindow,
  nurseId: string,
  date: IsoDate,
): boolean =>
  window.dates.has(date) &&
  (window.nurseIds.size === 0 || window.nurseIds.has(nurseId));

export const countActiveWindows = (
  windows: readonly PreferenceWindow[],
  now: Date,
): number => windows.filter((w) => isWindowActive(w, now)).length;

/**
 * Where preference collection stands for a schedule, as the Head Nurse sees it:
 * NONE (never opened), OPEN (at least one active window) or CLOSED (every
 * window closed or past its deadline).
 */
export type PreferenceCollectionState = "NONE" | "OPEN" | "CLOSED";

export function preferenceCollectionState(
  windows: readonly PreferenceWindow[],
  now: Date,
): PreferenceCollectionState {
  if (windows.length === 0) return "NONE";
  return countActiveWindows(windows, now) > 0 ? "OPEN" : "CLOSED";
}

/**
 * The nurse scope of a new window: every id must be on the schedule roster
 * (no silent dropping). Returns the de-duplicated, sorted ids; empty means the
 * whole roster.
 */
export function checkWindowNurses(
  nurseIds: readonly string[],
  rosterIds: ReadonlySet<string>,
): Result<string[], ValidationError> {
  const unique = [...new Set(nurseIds)].sort();
  const outside = unique.filter((id) => !rosterIds.has(id));
  return outside.length === 0
    ? ok(unique)
    : err(
        new ValidationError(
          `${outside.length} selected nurse(s) are not on the schedule roster`,
          "nurseIds",
        ),
      );
}
