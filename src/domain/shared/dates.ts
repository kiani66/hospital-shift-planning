import { err, ok, type Result } from "./result";
import { ValidationError } from "./errors";

/**
 * A calendar day as an ISO `YYYY-MM-DD` string. Calendar-system agnostic: Jalali
 * conversion happens only in the presentation layer. Arithmetic uses civil-day
 * numbers (no JS `Date`, so no timezone or DST effects).
 */
export type IsoDate = string & { readonly __brand: "IsoDate" };

/** 0 = Sunday … 6 = Saturday (same numbering as `Date#getUTCDay`). */
export type DayOfWeek = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export const SATURDAY: DayOfWeek = 6;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

const isLeapYear = (y: number) =>
  (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

const daysInMonth = (y: number, m: number) =>
  m === 2 ? (isLeapYear(y) ? 29 : 28) : [4, 6, 9, 11].includes(m) ? 30 : 31;

export function isIsoDate(value: unknown): value is IsoDate {
  if (typeof value !== "string") return false;
  const match = ISO_DATE.exec(value);
  if (!match) return false;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  return y >= 1 && m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
}

export function parseIsoDate(
  value: unknown,
  field = "date",
): Result<IsoDate, ValidationError> {
  return isIsoDate(value)
    ? ok(value)
    : err(
        new ValidationError(`${field} must be a valid YYYY-MM-DD date`, field),
      );
}

/** For trusted literals (tests, constants). Throws on invalid input. */
export function isoDate(value: string): IsoDate {
  if (!isIsoDate(value))
    throw new ValidationError(`Invalid ISO date: ${value}`);
  return value;
}

// Days since 1970-01-01 (proleptic Gregorian), after Howard Hinnant's algorithm.
function toDayNumber(date: IsoDate): number {
  let y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  const d = Number(date.slice(8, 10));
  y -= m <= 2 ? 1 : 0;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

function fromDayNumber(days: number): IsoDate {
  const z = days + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor(
    (doe -
      Math.floor(doe / 1460) +
      Math.floor(doe / 36524) -
      Math.floor(doe / 146096)) /
      365,
  );
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp + (mp < 10 ? 3 : -9);
  const y = yoe + era * 400 + (m <= 2 ? 1 : 0);
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}` as IsoDate;
}

export const addDays = (date: IsoDate, days: number): IsoDate =>
  fromDayNumber(toDayNumber(date) + days);

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export const daysBetween = (from: IsoDate, to: IsoDate): number =>
  toDayNumber(to) - toDayNumber(from);

/** ISO strings of this shape sort chronologically, so plain comparison is correct. */
export const compareIsoDates = (a: IsoDate, b: IsoDate): number =>
  a < b ? -1 : a > b ? 1 : 0;

export const dayOfWeek = (date: IsoDate): DayOfWeek =>
  // 1970-01-01 was a Thursday (4).
  ((((toDayNumber(date) + 4) % 7) + 7) % 7) as DayOfWeek;

/** First day of the week containing `date`; weeks start on Saturday by default. */
export function startOfWeek(
  date: IsoDate,
  weekStartsOn: DayOfWeek = SATURDAY,
): IsoDate {
  const offset = (dayOfWeek(date) - weekStartsOn + 7) % 7;
  return addDays(date, -offset);
}

/** Every day from `from` to `to`, inclusive. Empty when `to` is before `from`. */
export function eachDay(from: IsoDate, to: IsoDate): IsoDate[] {
  const count = daysBetween(from, to) + 1;
  return Array.from({ length: Math.max(count, 0) }, (_, i) => addDays(from, i));
}

/** Sorted, de-duplicated copy. */
export const uniqueSortedDates = (dates: Iterable<IsoDate>): IsoDate[] =>
  [...new Set(dates)].sort(compareIsoDates);
