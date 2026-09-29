import type { IsoDate } from "../shared/dates";
import { allow, deny, type Decision } from "../shared/decision";
import { isInPeriod, type DatePeriod } from "../shared/period";
import {
  acceptsPreferenceWindows,
  type ScheduleStatus,
} from "../schedule/status";
import {
  isWindowActive,
  windowCovers,
  type PreferenceWindow,
} from "./preference-window";

export type PreferenceEditDenial =
  | "NOT_ON_ROSTER"
  | "DATE_OUTSIDE_PERIOD"
  | "SCHEDULE_NOT_ACCEPTING_PREFERENCES"
  | "NO_ACTIVE_WINDOW";

export interface PreferenceEditContext {
  readonly nurseId: string;
  readonly date: IsoDate;
  readonly schedule: {
    readonly status: ScheduleStatus;
    readonly period: DatePeriod;
  };
  readonly onRoster: boolean;
  readonly windows: readonly PreferenceWindow[];
  readonly now: Date;
}

/**
 * Whether a nurse may set or clear their own preference for `date`.
 * Editing is granted only by an active window covering the date and nurse; a
 * status change (e.g. RETURNED) never grants it on its own.
 */
export function canEditPreference(
  ctx: PreferenceEditContext,
): Decision<PreferenceEditDenial> {
  if (!ctx.onRoster) return deny("NOT_ON_ROSTER");
  if (!isInPeriod(ctx.schedule.period, ctx.date))
    return deny("DATE_OUTSIDE_PERIOD");
  if (!acceptsPreferenceWindows(ctx.schedule.status))
    return deny("SCHEDULE_NOT_ACCEPTING_PREFERENCES");
  const covered = ctx.windows.some(
    (w) => isWindowActive(w, ctx.now) && windowCovers(w, ctx.nurseId, ctx.date),
  );
  return covered ? allow : deny("NO_ACTIVE_WINDOW");
}
