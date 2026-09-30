import {
  addDays,
  compareIsoDates,
  daysBetween,
  isoDate,
  type IsoDate,
} from "@/domain/shared/dates";

/**
 * Solar Hijri (Jalali) presentation adapter. The domain and database only
 * know ISO dates; this module converts at the UI boundary.
 *
 * Conversion is delegated to ICU's Persian calendar through `Intl` (the
 * platform's tested implementation), not to hand-written arithmetic. A JS
 * `Date` appears only as ICU's input: always UTC midnight of the ISO day,
 * formatted in UTC, so neither the server's nor the browser's timezone can
 * shift the day.
 */

export const JALALI_MONTHS = [
  "فروردین",
  "اردیبهشت",
  "خرداد",
  "تیر",
  "مرداد",
  "شهریور",
  "مهر",
  "آبان",
  "آذر",
  "دی",
  "بهمن",
  "اسفند",
] as const;

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

const weekdayFormat = new Intl.DateTimeFormat("fa-IR", {
  timeZone: "UTC",
  weekday: "long",
});

const digits = new Intl.NumberFormat("fa-IR", { useGrouping: false });
const grouped = new Intl.NumberFormat("fa-IR");

/** Persian digits without grouping (years, days). */
export const faDigits = (n: number) => digits.format(n);
/** Persian digits with grouping (counts). */
export const faNumber = (n: number) => grouped.format(n);

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

/**
 * The calendar month before or after `month`, or null past the supported
 * years. Purely temporal: whether the month has a schedule is irrelevant.
 */
export function adjacentJalaliMonth(
  month: JalaliMonth,
  direction: "previous" | "next",
): JalaliMonth | null {
  const target =
    direction === "previous"
      ? previousJalaliMonth(month)
      : nextJalaliMonth(month);
  return isJalaliMonth(target) ? target : null;
}

/** "1405-08": a Jalali month as it appears in a URL (`?month=`). */
export const jalaliMonthParam = ({ year, month }: JalaliMonth) =>
  `${year}-${String(month).padStart(2, "0")}`;

/** The month of a `?month=` value, or null when it is not a supported Jalali month. */
export function parseJalaliMonthParam(value: unknown): JalaliMonth | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) return null;
  const month = { year: Number(match[1]), month: Number(match[2]) };
  return isJalaliMonth(month) ? month : null;
}

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

/** "آبان ۱۴۰۵" */
export const jalaliMonthLabel = ({ year, month }: JalaliMonth) =>
  `${JALALI_MONTHS[month - 1]} ${faDigits(year)}`;

/** "۱ آبان ۱۴۰۵", or with the weekday "جمعه ۱ آبان ۱۴۰۵". */
export function formatJalaliDate(
  date: IsoDate,
  options: { weekday?: boolean } = {},
): string {
  const j = toJalali(date);
  const text = `${faDigits(j.day)} ${JALALI_MONTHS[j.month - 1]} ${faDigits(j.year)}`;
  return options.weekday ? `${jalaliWeekday(date)} ${text}` : text;
}

/** The Persian weekday name, e.g. "شنبه". */
export const jalaliWeekday = (date: IsoDate): string =>
  weekdayFormat.format(utcMidnight(date));

/** "۱ تا ۳۰ آبان ۱۴۰۵" within one month, otherwise both dates in full. */
export function formatJalaliRange(from: IsoDate, to: IsoDate): string {
  const a = toJalali(from);
  const b = toJalali(to);
  if (a.year === b.year && a.month === b.month)
    return `${faDigits(a.day)} تا ${faDigits(b.day)} ${JALALI_MONTHS[a.month - 1]} ${faDigits(a.year)}`;
  return `${formatJalaliDate(from)} تا ${formatJalaliDate(to)}`;
}

/** A point in time (audit, window open/close) as Tehran-local Jalali date and time. */
export function formatJalaliDateTime(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("fa-IR-u-ca-persian", {
    timeZone,
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(instant);
}

/** Whether a period is exactly one whole Jalali month (for labels). */
export function wholeJalaliMonthOf(period: {
  start: IsoDate;
  end: IsoDate;
}): JalaliMonth | null {
  const j = toJalali(period.start);
  if (j.day !== 1) return null;
  const month = { year: j.year, month: j.month };
  return compareIsoDates(jalaliMonthPeriod(month).end, period.end) === 0
    ? month
    : null;
}

export interface JalaliMonthOption extends JalaliMonth {
  readonly label: string;
  readonly startLabel: string;
  readonly endLabel: string;
  readonly dayCount: number;
  /** An existing schedule of the department shares at least one day. */
  readonly taken: boolean;
}

/**
 * Months offered in the create form: every month of the current Jalali year
 * (in Tehran, from `today`) and the next, plus the suggested default (the
 * month after the current one, the usual planning horizon). With `focus` (the
 * month the Head Nurse is looking at), that month's year is offered too and
 * the month itself is the suggestion.
 */
export function jalaliMonthOptions(
  today: IsoDate,
  existing: readonly { start: IsoDate; end: IsoDate }[],
  focus?: JalaliMonth,
): { years: number[]; options: JalaliMonthOption[]; suggested: JalaliMonth } {
  const current = toJalali(today);
  const years = [
    ...new Set([
      current.year,
      current.year + 1,
      ...(focus ? [focus.year] : []),
    ]),
  ].sort((a, b) => a - b);
  const options = years.flatMap((year) =>
    JALALI_MONTHS.map((_, i) => {
      const month = { year, month: i + 1 };
      const { start, end } = jalaliMonthPeriod(month);
      return {
        ...month,
        label: jalaliMonthLabel(month),
        startLabel: formatJalaliDate(start, { weekday: true }),
        endLabel: formatJalaliDate(end, { weekday: true }),
        dayCount: daysBetween(start, end) + 1,
        taken: existing.some(
          (p) =>
            compareIsoDates(p.start, end) <= 0 &&
            compareIsoDates(p.end, start) >= 0,
        ),
      };
    }),
  );
  const next = nextJalaliMonth(current);
  const suggested =
    focus ??
    options.find(
      (o) =>
        !o.taken &&
        (o.year > next.year || (o.year === next.year && o.month >= next.month)),
    ) ??
    next;
  return {
    years,
    options,
    suggested: { year: suggested.year, month: suggested.month },
  };
}
