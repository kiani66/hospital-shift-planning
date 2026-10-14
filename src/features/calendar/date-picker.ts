import {
  addDays,
  compareIsoDates,
  daysBetween,
  startOfWeek,
  type IsoDate,
} from "@/domain/shared/dates";

import {
  faDigits,
  formatJalaliDate,
  isJalaliMonth,
  JALALI_MONTHS,
  jalaliMonthPeriod,
  MAX_JALALI_YEAR,
  MIN_JALALI_YEAR,
  toJalali,
  type JalaliMonth,
} from "./jalali";
import { parseJalaliInput } from "./jalali-input";
import { monthGrid } from "./month-grid";

/**
 * Pure model of the Jalali date picker (`jalali-date-picker.tsx`): range
 * checks, keyboard movement, the visible month and typed-text validation.
 * Dates stay ISO; Jalali appears only through the calendar adapter.
 */

export interface DateBounds {
  readonly minDate?: IsoDate | null;
  readonly maxDate?: IsoDate | null;
}

/** The first and last days the adapter supports (1300/01/01 to 1500/12/end). */
const SUPPORTED = {
  start: jalaliMonthPeriod({ year: MIN_JALALI_YEAR, month: 1 }).start,
  end: jalaliMonthPeriod({ year: MAX_JALALI_YEAR, month: 12 }).end,
};

export function isOutOfRange(date: IsoDate, bounds: DateBounds): boolean {
  return (
    (!!bounds.minDate && compareIsoDates(date, bounds.minDate) < 0) ||
    (!!bounds.maxDate && compareIsoDates(date, bounds.maxDate) > 0)
  );
}

/** The nearest day inside the bounds and the supported years. */
export function clampDate(date: IsoDate, bounds: DateBounds): IsoDate {
  let result = date;
  const low =
    bounds.minDate && compareIsoDates(bounds.minDate, SUPPORTED.start) > 0
      ? bounds.minDate
      : SUPPORTED.start;
  const high =
    bounds.maxDate && compareIsoDates(bounds.maxDate, SUPPORTED.end) < 0
      ? bounds.maxDate
      : SUPPORTED.end;
  if (compareIsoDates(result, low) < 0) result = low;
  if (compareIsoDates(result, high) > 0) result = high;
  return result;
}

export const jalaliMonthOf = (date: IsoDate): JalaliMonth => {
  const { year, month } = toJalali(date);
  return { year, month };
};

export function jalaliMonthLength(month: JalaliMonth): number {
  const { start, end } = jalaliMonthPeriod(month);
  return daysBetween(start, end) + 1;
}

/**
 * The same Jalali day of month in `target`, or its last day when shorter
 * (31 Shahrivar → 30 Mehr, 30 Esfand of a leap year → 29 Esfand).
 */
export function sameDayIn(date: IsoDate, target: JalaliMonth): IsoDate {
  const { start } = jalaliMonthPeriod(target);
  const day = Math.min(toJalali(date).day, jalaliMonthLength(target));
  return addDays(start, day - 1);
}

/** The same day `months` Jalali months later (negative: earlier), or null past the supported years. */
export function shiftMonths(date: IsoDate, months: number): IsoDate | null {
  const { year, month } = toJalali(date);
  const index = year * 12 + (month - 1) + months;
  const target = { year: Math.floor(index / 12), month: (index % 12) + 1 };
  return isJalaliMonth(target) ? sameDayIn(date, target) : null;
}

/**
 * Where a grid key moves the focused day, or null for keys the grid does not
 * handle. In the RTL layout (Saturday at the inline start, `ltr: false` is the
 * default) ArrowLeft is the next day; in LTR it is the previous one. Home/End go to the start/end of the
 * Saturday-first week; PageUp/PageDown change the month (with Shift, the
 * year). The result is clamped into the bounds and the supported years.
 */
export function moveFocus(
  date: IsoDate,
  key: string,
  options: DateBounds & { shiftKey?: boolean; ltr?: boolean } = {},
): IsoDate | null {
  const forward = options.ltr ? 1 : -1;
  let target: IsoDate | null;
  switch (key) {
    case "ArrowLeft":
      target = addDays(date, -forward);
      break;
    case "ArrowRight":
      target = addDays(date, forward);
      break;
    case "ArrowDown":
      target = addDays(date, 7);
      break;
    case "ArrowUp":
      target = addDays(date, -7);
      break;
    case "Home":
      target = startOfWeek(date);
      break;
    case "End":
      target = addDays(startOfWeek(date), 6);
      break;
    case "PageUp":
      target = shiftMonths(date, options.shiftKey ? -12 : -1) ?? date;
      break;
    case "PageDown":
      target = shiftMonths(date, options.shiftKey ? 12 : 1) ?? date;
      break;
    default:
      return null;
  }
  return clampDate(target, options);
}

export interface PickerDay {
  readonly date: IsoDate;
  /** Jalali day of month in Persian digits. */
  readonly label: string;
  /** Full accessible name, e.g. «جمعه ۱۱ مهر ۱۴۰۵». */
  readonly name: string;
  readonly selected: boolean;
  readonly today: boolean;
  readonly focused: boolean;
  readonly disabled: boolean;
}

export interface PickerMonth {
  readonly month: JalaliMonth;
  readonly label: string;
  readonly weekdays: readonly { long: string; short: string }[];
  /** Saturday-first weeks; null for the cells outside the month. */
  readonly weeks: readonly (readonly (PickerDay | null)[])[];
  readonly canGoPrevious: boolean;
  readonly canGoNext: boolean;
}

/** The month containing `focused`, laid out as Saturday-first weeks. */
export function pickerMonth(
  focused: IsoDate,
  state: DateBounds & { selected: IsoDate | null; today: IsoDate | null },
): PickerMonth {
  const month = jalaliMonthOf(focused);
  const period = jalaliMonthPeriod(month);
  const grid = monthGrid(period, []);
  const previous = shiftMonths(focused, -1);
  const next = shiftMonths(focused, 1);
  return {
    month,
    label: `${JALALI_MONTHS[month.month - 1]} ${faDigits(month.year)}`,
    weekdays: grid.weekdays,
    weeks: grid.weeks.map((week) =>
      week.map((cell) =>
        cell.inPeriod
          ? {
              date: cell.date,
              label: cell.dayNumber,
              name: formatJalaliDate(cell.date, { weekday: true }),
              selected: cell.date === state.selected,
              today: cell.date === state.today,
              focused: cell.date === focused,
              disabled: isOutOfRange(cell.date, state),
            }
          : null,
      ),
    ),
    canGoPrevious:
      previous !== null && monthInRange(jalaliMonthOf(previous), state),
    canGoNext: next !== null && monthInRange(jalaliMonthOf(next), state),
  };
}

/** Years offered by the year selector: the supported years within the bounds. */
export function pickerYears(bounds: DateBounds): number[] {
  const from = bounds.minDate
    ? Math.max(MIN_JALALI_YEAR, toJalali(bounds.minDate).year)
    : MIN_JALALI_YEAR;
  const to = bounds.maxDate
    ? Math.min(MAX_JALALI_YEAR, toJalali(bounds.maxDate).year)
    : MAX_JALALI_YEAR;
  return Array.from({ length: Math.max(to - from + 1, 0) }, (_, i) => from + i);
}

/** Whether any day of `month` lies inside the bounds. */
export function monthInRange(month: JalaliMonth, bounds: DateBounds): boolean {
  const { start, end } = jalaliMonthPeriod(month);
  return !(
    (bounds.minDate && compareIsoDates(end, bounds.minDate) < 0) ||
    (bounds.maxDate && compareIsoDates(start, bounds.maxDate) > 0)
  );
}

export type DateTextResult =
  | { readonly ok: true; readonly value: IsoDate | null }
  | { readonly ok: false; readonly message: string };

export const DATE_MESSAGES = {
  required: "تاریخ شمسی را وارد کنید.",
  format: "تاریخ شمسی معتبر با قالب سال/ماه/روز وارد کنید.",
  years: `سال باید بین ${faDigits(MIN_JALALI_YEAR)} و ${faDigits(MAX_JALALI_YEAR)} باشد.`,
  before: (min: IsoDate) =>
    `تاریخ نمی‌تواند قبل از ${formatJalaliDate(min)} باشد.`,
  after: (max: IsoDate) =>
    `تاریخ نمی‌تواند بعد از ${formatJalaliDate(max)} باشد.`,
  monthLength: (month: JalaliMonth) =>
    `${JALALI_MONTHS[month.month - 1]} ${faDigits(month.year)} فقط ${faDigits(jalaliMonthLength(month))} روز دارد.`,
} as const;

const toLatinDigits = (text: string) =>
  text.replace(/[۰-۹٠-٩]/g, (digit) =>
    String(digit.charCodeAt(0) - (digit >= "۰" ? 0x06f0 : 0x0660)),
  );

/**
 * Validates typed text: empty (allowed unless required), a real Jalali day
 * (Persian, Arabic or Latin digits, `/` or `-`), then the bounds. Parsing is
 * `parseJalaliInput`, the same function the server uses.
 */
export function validateDateText(
  text: string,
  options: DateBounds & { required?: boolean },
): DateTextResult {
  const trimmed = text.trim();
  if (trimmed === "")
    return options.required
      ? { ok: false, message: DATE_MESSAGES.required }
      : { ok: true, value: null };
  const value = parseJalaliInput(trimmed);
  if (!value) return { ok: false, message: invalidReason(trimmed) };
  return rangeResult(value, options);
}

/** Bounds check of an already valid day. */
export function rangeResult(
  value: IsoDate,
  bounds: DateBounds,
): DateTextResult {
  if (bounds.minDate && compareIsoDates(value, bounds.minDate) < 0)
    return { ok: false, message: DATE_MESSAGES.before(bounds.minDate) };
  if (bounds.maxDate && compareIsoDates(value, bounds.maxDate) > 0)
    return { ok: false, message: DATE_MESSAGES.after(bounds.maxDate) };
  return { ok: true, value };
}

function invalidReason(text: string): string {
  const match = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/.exec(toLatinDigits(text));
  if (!match) return DATE_MESSAGES.format;
  const month = { year: Number(match[1]), month: Number(match[2]) };
  if (month.year < MIN_JALALI_YEAR || month.year > MAX_JALALI_YEAR)
    return DATE_MESSAGES.years;
  if (!isJalaliMonth(month) || Number(match[3]) < 1)
    return DATE_MESSAGES.format;
  return DATE_MESSAGES.monthLength(month);
}
