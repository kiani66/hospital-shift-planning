import { compareIsoDates, eachDay, parseIsoDate, type IsoDate } from "./dates";
import { ValidationError } from "./errors";
import { err, ok, type Result } from "./result";

/**
 * The inclusive date range a schedule covers. Calendar agnostic: a Jalali month
 * is simply the Gregorian dates it maps to.
 */
export interface DatePeriod {
  readonly start: IsoDate;
  readonly end: IsoDate;
}

/** Upper bound guards against accidental multi-year periods. */
export const MAX_PERIOD_DAYS = 62;

export function createPeriod(
  start: unknown,
  end: unknown,
): Result<DatePeriod, ValidationError> {
  const s = parseIsoDate(start, "periodStart");
  if (!s.ok) return s;
  const e = parseIsoDate(end, "periodEnd");
  if (!e.ok) return e;
  if (compareIsoDates(s.value, e.value) > 0) {
    return err(
      new ValidationError(
        "periodEnd must not be before periodStart",
        "periodEnd",
      ),
    );
  }
  const period = { start: s.value, end: e.value };
  if (periodDays(period).length > MAX_PERIOD_DAYS) {
    return err(
      new ValidationError(
        `A period may span at most ${MAX_PERIOD_DAYS} days`,
        "periodEnd",
      ),
    );
  }
  return ok(period);
}

export const isInPeriod = (period: DatePeriod, date: IsoDate): boolean =>
  compareIsoDates(date, period.start) >= 0 &&
  compareIsoDates(date, period.end) <= 0;

export const periodDays = (period: DatePeriod): IsoDate[] =>
  eachDay(period.start, period.end);
