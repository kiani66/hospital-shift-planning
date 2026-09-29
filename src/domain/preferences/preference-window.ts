import type { IsoDate } from "../shared/dates";

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
