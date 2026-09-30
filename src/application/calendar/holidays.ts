import type { IsoDate } from "../../domain/shared/dates";
import type { DatePeriod } from "../../domain/shared/period";

/** An official (public) holiday, by ISO date; calendar agnostic like every stored day. */
export interface OfficialHoliday {
  readonly date: IsoDate;
  /** Persian name for display, e.g. "عید فطر". */
  readonly name: string;
}

/**
 * Where official holidays come from. Holiday is a separate dimension from a
 * day's review health: a day is holiday or not, and independently unplanned,
 * valid or needing attention.
 *
 * The intended source is a maintained master calendar covering several years
 * (Iran's official holidays follow both the solar and the lunar calendar, so
 * they are published, not computed). No weekday is treated as a holiday here:
 * weekend rules are a separate, later decision.
 */
export interface HolidayCalendar {
  /** The official holidays inside `period`, in any order. */
  listOfficialHolidays(period: DatePeriod): Promise<readonly OfficialHoliday[]>;
}

/** The source in use until a master calendar is connected: no holiday data yet. */
export const NO_HOLIDAY_DATA: HolidayCalendar = {
  listOfficialHolidays: async () => [],
};
