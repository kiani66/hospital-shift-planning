import {
  addDays,
  daysBetween,
  startOfWeek,
  type IsoDate,
} from "@/domain/shared/dates";
import { isInPeriod, type DatePeriod } from "@/domain/shared/period";

import { faDigits, jalaliWeekday, toJalali } from "./jalali";

export interface MonthGridCell<D> {
  readonly date: IsoDate;
  /** Jalali day of month, in Persian digits. */
  readonly dayNumber: string;
  /** False for the leading/trailing days that only complete the first and last week. */
  readonly inPeriod: boolean;
  /** The caller's data for in-period days; null for the others. */
  readonly data: D | null;
}

export interface MonthGrid<D> {
  /** Column headers, Saturday first. */
  readonly weekdays: readonly {
    readonly long: string;
    readonly short: string;
  }[];
  /** Whole Saturday-first weeks: as many rows as the period needs (5 or 6 for a Jalali month). */
  readonly weeks: readonly (readonly MonthGridCell<D>[])[];
}

/**
 * Lays out a period as a 7-column calendar: whole Saturday-first weeks from
 * the week containing the first day to the week containing the last. The
 * number of rows follows from the period (never a fixed 35 or 42 cells).
 */
export function monthGrid<D extends { readonly date: IsoDate }>(
  period: DatePeriod,
  days: readonly D[],
): MonthGrid<D> {
  const byDate = new Map(days.map((d) => [d.date, d]));
  const first = startOfWeek(period.start);
  const last = addDays(startOfWeek(period.end), 6);
  const count = daysBetween(first, last) + 1;

  const weeks: MonthGridCell<D>[][] = [];
  for (let i = 0; i < count; i++) {
    const date = addDays(first, i);
    const inPeriod = isInPeriod(period, date);
    if (i % 7 === 0) weeks.push([]);
    weeks.at(-1)!.push({
      date,
      dayNumber: faDigits(toJalali(date).day),
      inPeriod,
      data: inPeriod ? (byDate.get(date) ?? null) : null,
    });
  }

  const weekdays = weeks[0]!.map(({ date }) => {
    const long = jalaliWeekday(date);
    return { long, short: long.charAt(0) };
  });
  return { weekdays, weeks };
}
