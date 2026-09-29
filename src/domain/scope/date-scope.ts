import {
  addDays,
  compareIsoDates,
  eachDay,
  isIsoDate,
  SATURDAY,
  startOfWeek,
  uniqueSortedDates,
  type DayOfWeek,
  type IsoDate,
} from "../shared/dates";
import { ValidationError } from "../shared/errors";
import { isInPeriod, periodDays, type DatePeriod } from "../shared/period";
import { err, ok, type Result } from "../shared/result";

/**
 * How the Head Nurse describes a set of dates to reopen (or to revise).
 * Used for preference windows and for revision scopes.
 */
export type DateScopeInput =
  | { readonly kind: "DAY"; readonly date: string }
  | { readonly kind: "DAYS"; readonly dates: readonly string[] }
  | { readonly kind: "RANGE"; readonly from: string; readonly to: string }
  | { readonly kind: "WEEK"; readonly anyDateInWeek: string }
  | { readonly kind: "PERIOD" };

export type DateScopeKind = DateScopeInput["kind"];

/** The expanded scope: always an explicit, sorted, non-empty set of dates. */
export interface DateScope {
  /** Kept for display ("reopened week 4"); `dates` is the source of truth. */
  readonly kind: DateScopeKind;
  readonly dates: readonly IsoDate[];
}

const invalid = (message: string, field: string) =>
  err(new ValidationError(message, field));

/**
 * Expands `input` into explicit dates inside `period`.
 *
 * - DAY, DAYS, RANGE: every date must be valid and inside the period (no silent clipping).
 * - WEEK: the week (starting on `weekStartsOn`, Saturday by default) containing
 *   `anyDateInWeek`, clipped to the period; the anchor date must be inside it.
 * - PERIOD: every day of the period.
 */
export function expandDateScope(
  input: DateScopeInput,
  period: DatePeriod,
  weekStartsOn: DayOfWeek = SATURDAY,
): Result<DateScope, ValidationError> {
  const inPeriod = (field: string) => (d: string) => {
    if (!isIsoDate(d))
      return invalid(`${field} must be a valid YYYY-MM-DD date`, field);
    if (!isInPeriod(period, d))
      return invalid(`${field} ${d} is outside the schedule period`, field);
    return ok(d);
  };

  switch (input.kind) {
    case "DAY": {
      const d = inPeriod("date")(input.date);
      return d.ok ? ok({ kind: input.kind, dates: [d.value] }) : d;
    }
    case "DAYS": {
      if (input.dates.length === 0)
        return invalid("Select at least one date", "dates");
      const dates: IsoDate[] = [];
      for (const raw of input.dates) {
        const d = inPeriod("dates")(raw);
        if (!d.ok) return d;
        dates.push(d.value);
      }
      return ok({ kind: input.kind, dates: uniqueSortedDates(dates) });
    }
    case "RANGE": {
      const from = inPeriod("from")(input.from);
      if (!from.ok) return from;
      const to = inPeriod("to")(input.to);
      if (!to.ok) return to;
      if (compareIsoDates(from.value, to.value) > 0)
        return invalid("'to' must not be before 'from'", "to");
      return ok({ kind: input.kind, dates: eachDay(from.value, to.value) });
    }
    case "WEEK": {
      const anchor = inPeriod("anyDateInWeek")(input.anyDateInWeek);
      if (!anchor.ok) return anchor;
      const start = startOfWeek(anchor.value, weekStartsOn);
      const dates = eachDay(start, addDays(start, 6)).filter((d) =>
        isInPeriod(period, d),
      );
      return ok({ kind: input.kind, dates });
    }
    case "PERIOD":
      return ok({ kind: input.kind, dates: periodDays(period) });
  }
}

export const scopeIncludes = (scope: DateScope, date: IsoDate): boolean =>
  scope.dates.includes(date);
