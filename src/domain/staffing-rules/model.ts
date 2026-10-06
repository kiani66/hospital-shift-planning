import { compareIsoDates, isIsoDate, type IsoDate } from "../shared/dates";
import { ValidationError } from "../shared/errors";
import { err, ok, type Result } from "../shared/result";
import { COVERAGE_PERIODS, type BaseShift } from "../shifts/shift-type";

/**
 * Versioned staffing/coverage rule sets (D105). A rule set is a lineage per
 * scope (the Hospital Default, or one Department Override); each version is a
 * complete, independent snapshot of the bounds. Schedules pin exactly one
 * version (D106), so the numbers are data, never constants in code.
 */

export const RULE_SET_STATUSES = ["DRAFT", "PUBLISHED", "RETIRED"] as const;

/** DRAFT is editable; PUBLISHED and RETIRED are immutable and never deleted. */
export type RuleSetStatus = (typeof RULE_SET_STATUSES)[number];

export const RULE_SET_RETIRE_REASONS = ["REPLACED", "WITHDRAWN"] as const;

/** Why a version was retired: replaced by a conflicting publication, or withdrawn. */
export type RuleSetRetireReason = (typeof RULE_SET_RETIRE_REASONS)[number];

export const DAY_TYPES = ["NORMAL", "HOLIDAY"] as const;

/** The kind of day a set of bounds applies to (holidays come from `HolidayCalendar`, D41). */
export type DayType = (typeof DAY_TYPES)[number];

/** Upper limit for a stored bound (a sanity guard against typing errors, not a rule). */
export const MAX_STAFF_BOUND = 99;

/** Bounds of one coverage bucket. A null maximum means "no maximum". */
export interface CoverageBounds {
  readonly min: number;
  readonly max: number | null;
}

/** Bounds for one bucket of one specific date; they override the day type. */
export interface DateException {
  readonly date: IsoDate;
  readonly period: BaseShift;
  readonly bounds: CoverageBounds;
  readonly note: string | null;
}

/**
 * Everything a version stores. NORMAL bounds are required for every bucket;
 * HOLIDAY bounds are optional per bucket (a bucket without one uses NORMAL).
 */
export interface RuleSetContent {
  readonly normal: Readonly<Record<BaseShift, CoverageBounds>>;
  readonly holiday: Readonly<Partial<Record<BaseShift, CoverageBounds>>>;
  /** Sorted by date, then bucket (M, E, N). */
  readonly exceptions: readonly DateException[];
}

/** The identity and lifecycle of a version (its content is loaded separately). */
export interface RuleSetVersionHead {
  readonly id: string;
  readonly ruleSetId: string;
  /** The lineage's department; null for the Hospital Default. */
  readonly departmentId: string | null;
  readonly versionNo: number;
  readonly status: RuleSetStatus;
  /** Set exactly when the version is (or was) published. */
  readonly effectiveFrom: IsoDate | null;
}

/** Upper bound of a version or exception note (plain text). */
export const RULE_SET_NOTE_MAX_LENGTH = 500;

const bucketOrder = (period: BaseShift) => COVERAGE_PERIODS.indexOf(period);

function checkBounds(
  bounds: CoverageBounds,
  field: string,
): ValidationError | null {
  const valid = (n: number) =>
    Number.isInteger(n) && n >= 0 && n <= MAX_STAFF_BOUND;
  if (!valid(bounds.min))
    return new ValidationError(
      `Minimum must be a whole number from 0 to ${MAX_STAFF_BOUND}`,
      field,
    );
  if (bounds.max !== null && !valid(bounds.max))
    return new ValidationError(
      `Maximum must be empty or a whole number from 0 to ${MAX_STAFF_BOUND}`,
      field,
    );
  if (bounds.max !== null && bounds.max < bounds.min)
    return new ValidationError("Maximum must not be below minimum", field);
  return null;
}

/**
 * Checks a version's content before it is stored: whole numbers 0–99, a
 * maximum that is empty or at least the minimum, every NORMAL bucket present,
 * real dates and at most one exception per date and bucket. Returns the
 * content with its exceptions sorted.
 */
export function validateRuleSetContent(
  content: RuleSetContent,
): Result<RuleSetContent, ValidationError> {
  for (const period of COVERAGE_PERIODS) {
    const normal = content.normal[period];
    if (!normal)
      return err(
        new ValidationError(`Normal bounds for ${period} are required`, period),
      );
    const problem =
      checkBounds(normal, `normal.${period}`) ??
      (content.holiday[period]
        ? checkBounds(content.holiday[period], `holiday.${period}`)
        : null);
    if (problem) return err(problem);
  }
  const seen = new Set<string>();
  for (const exception of content.exceptions) {
    if (!isIsoDate(exception.date))
      return err(new ValidationError("Invalid exception date", "exceptions"));
    const key = `${exception.date}|${exception.period}`;
    if (seen.has(key))
      return err(
        new ValidationError(
          "Only one exception per date and shift is allowed",
          "exceptions",
        ),
      );
    seen.add(key);
    const problem = checkBounds(exception.bounds, "exceptions");
    if (problem) return err(problem);
  }
  return ok({
    ...content,
    exceptions: [...content.exceptions].sort(
      (a, b) =>
        compareIsoDates(a.date, b.date) ||
        bucketOrder(a.period) - bucketOrder(b.period),
    ),
  });
}
