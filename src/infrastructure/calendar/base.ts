import { dayOfWeek, eachDay, type IsoDate } from "../../domain/shared/dates";
import type { CalendarDay } from "../../domain/calendar/official-calendar";
import { ValidationError } from "../../domain/shared/errors";
import {
  jalaliMonthPeriod,
  MAX_JALALI_YEAR,
  MIN_JALALI_YEAR,
  toJalali,
} from "./jalali";

export function calendarYearPeriod(year: number) {
  if (
    !Number.isInteger(year) ||
    year < MIN_JALALI_YEAR ||
    year > MAX_JALALI_YEAR
  )
    throw new ValidationError("Unsupported Jalali calendar year", "year");
  return {
    start: jalaliMonthPeriod({ year, month: 1 }).start,
    end: jalaliMonthPeriod({ year, month: 12 }).end,
  };
}

/** Five previous years, the current year in Tehran, and four future years. */
export function calendarHorizon(today: IsoDate): number[] {
  const current = toJalali(today).year;
  const years = Array.from({ length: 10 }, (_, i) => current - 5 + i);
  years.forEach(calendarYearPeriod);
  return years;
}

export function generateCalendarDays(year: number): CalendarDay[] {
  const period = calendarYearPeriod(year);
  return eachDay(period.start, period.end).map((date) => ({
    date,
    isFriday: dayOfWeek(date) === 5,
    officialStatus: "UNKNOWN",
    holidayNames: [],
  }));
}
