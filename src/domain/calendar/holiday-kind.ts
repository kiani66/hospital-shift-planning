import { dayOfWeek, type DayOfWeek, type IsoDate } from "../shared/dates";

/**
 * Why a day is printed as a holiday (D124). One classification serves the
 * weekly rest day and, once a master calendar is connected, the official
 * holidays (`HolidayCalendar`, D41), so both get the same presentation.
 *
 * Presentation only: staffing rules still select HOLIDAY bounds from
 * official holidays alone (D41); Friday is not a staffing holiday.
 */
export type HolidayKind = "WEEKLY_REST" | "OFFICIAL";

/** Friday, the weekly rest day (same numbering as `dayOfWeek`). */
export const WEEKLY_REST_DAY: DayOfWeek = 5;

/** The day's holiday kind, or null for a working day. An official holiday wins. */
export function holidayKindOf(
  date: IsoDate,
  officialHolidays: ReadonlySet<IsoDate> = new Set(),
): HolidayKind | null {
  if (officialHolidays.has(date)) return "OFFICIAL";
  return dayOfWeek(date) === WEEKLY_REST_DAY ? "WEEKLY_REST" : null;
}
