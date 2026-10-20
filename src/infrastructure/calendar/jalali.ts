import { addDays, isoDate, type IsoDate } from "../../domain/shared/dates";

/** Shared ICU Persian calendar adapter; UTC prevents timezone-dependent day shifts. */
/** Years the conversion is used for; far outside it is a caller error. */
export const MIN_JALALI_YEAR = 1300;
export const MAX_JALALI_YEAR = 1500;

export interface JalaliDate {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

export interface JalaliMonth {
  readonly year: number;
  readonly month: number;
}

const utcMidnight = (date: IsoDate) => new Date(`${date}T00:00:00Z`);

const partsFormat = new Intl.DateTimeFormat("en-u-ca-persian-nu-latn", {
  timeZone: "UTC",
  year: "numeric",
  month: "numeric",
  day: "numeric",
});

export function toJalali(date: IsoDate): JalaliDate {
  const parts = partsFormat.formatToParts(utcMidnight(date));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value);
  return { year: get("year"), month: get("month"), day: get("day") };
}

export function isJalaliMonth(value: {
  year: unknown;
  month: unknown;
}): value is JalaliMonth {
  const { year, month } = value;
  return (
    Number.isInteger(year) &&
    Number.isInteger(month) &&
    (year as number) >= MIN_JALALI_YEAR &&
    (year as number) <= MAX_JALALI_YEAR &&
    (month as number) >= 1 &&
    (month as number) <= 12
  );
}

/** The ISO date of the first day of a Jalali month. */
function firstDayOf({ year, month }: JalaliMonth): IsoDate {
  // A guess within a few days (Farvardin 1 is 20 or 21 March; the first six
  // months have 31 days, the next five 30), then ICU decides the exact day.
  const offset = month <= 6 ? (month - 1) * 31 : 186 + (month - 7) * 30;
  const guess = addDays(isoDate(`${year + 621}-03-21`), offset);
  for (const delta of [0, -1, 1, -2, 2, -3, 3]) {
    const candidate = addDays(guess, delta);
    const j = toJalali(candidate);
    if (j.year === year && j.month === month && j.day === 1) return candidate;
  }
  throw new RangeError(`Cannot locate Jalali month ${year}/${month}`);
}

export const nextJalaliMonth = ({ year, month }: JalaliMonth): JalaliMonth =>
  month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };

export const previousJalaliMonth = ({
  year,
  month,
}: JalaliMonth): JalaliMonth =>
  month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };

/** The inclusive ISO period of a whole Jalali month (what a schedule stores). */
export function jalaliMonthPeriod(month: JalaliMonth): {
  start: IsoDate;
  end: IsoDate;
} {
  const { year, month: m } = month;
  if (!isJalaliMonth(month))
    throw new RangeError(`Invalid Jalali month ${year}/${m}`);
  const start = firstDayOf(month);
  const end = addDays(firstDayOf(nextJalaliMonth(month)), -1);
  return { start, end };
}
