import type { Route } from "next";

import { addDays, isIsoDate, type IsoDate } from "@/domain/shared/dates";

import { isJalaliMonth, toJalali } from "@/features/calendar/jalali";

export const CALENDAR_VIEW_COOKIE = "hsp.nurse.calendar-view";
export type CalendarView = "week" | "month";
export const parseCalendarView = (value: unknown): CalendarView | null =>
  value === "week" || value === "month" ? value : null;

export const weekPeriod = (start: IsoDate) => ({
  start,
  end: addDays(start, 6),
});

/** Keep calendar presentation within the existing Jalali adapter's supported years. */
export function weekStart(value: unknown, today: IsoDate): IsoDate {
  return isIsoDate(value) &&
    isJalaliMonth(toJalali(value)) &&
    isJalaliMonth(toJalali(addDays(value, 6)))
    ? value
    : today;
}

export function weeklyHref(start: IsoDate, day?: IsoDate): Route {
  const params = new URLSearchParams({ view: "week", start });
  if (day) params.set("day", day);
  return `/my-shifts?${params}` as Route;
}
