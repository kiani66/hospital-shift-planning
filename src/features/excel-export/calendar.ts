import type { ExcelExportCalendar } from "@/application/excel-export/export";
import type { DatePeriod } from "@/domain/shared/period";
import {
  JALALI_MONTHS,
  jalaliWeekday,
  jalaliWeekdayInitial,
  toJalali,
  type JalaliDate,
} from "@/features/calendar/jalali";

/** «مهرماه 1405»: the month name, «ماه» (joined by ZWNJ) and the year, as hospital sheets print it. */
const monthTitle = ({ year, month }: JalaliDate) =>
  `${JALALI_MONTHS[month - 1]}‌ماه ${year}`;

/**
 * The month heading of an export: the schedule's Jalali month and year, or
 * both months for a period that crosses a month boundary.
 */
export function exportMonthHeading(period: DatePeriod): string {
  const start = toJalali(period.start);
  const end = toJalali(period.end);
  return start.year === end.year && start.month === end.month
    ? monthTitle(start)
    : `${monthTitle(start)} تا ${monthTitle(end)}`;
}

/** The Jalali calendar of an Excel export (D124), from the shared Jalali adapter. */
export const jalaliExportCalendar: ExcelExportCalendar = {
  dayNumber: (date) => toJalali(date).day,
  weekday: (date, format) =>
    format === "NARROW" ? jalaliWeekdayInitial(date) : jalaliWeekday(date),
  monthHeading: exportMonthHeading,
};
