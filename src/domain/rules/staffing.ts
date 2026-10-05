import type { IsoDate } from "../shared/dates";
import { isInPeriod, type DatePeriod } from "../shared/period";
import type { Assignment } from "../shifts/assignment";
import { countByShift, coverageOf } from "../shifts/coverage";
import { COVERAGE_PERIODS, type BaseShift } from "../shifts/shift-type";
import type { Violation } from "./violation";

/** Staffing bounds per coverage period. A minimum shortfall blocks finalization and
 * newly introduced post-finalization shortages; an upper-bound excess remains advisory.
 */
export interface StaffingBounds {
  /** Fewest nurses the coverage period needs. */
  readonly min?: number;
  /** Most nurses the coverage period should have. */
  readonly max?: number;
}

/** One day's requirement per coverage period; a missing period is not configured. */
export type StaffingRequirement = Readonly<
  Partial<Record<BaseShift, StaffingBounds>>
>;

export type StaffingStatus =
  "NOT_CONFIGURED" | "BELOW_MINIMUM" | "WITHIN_BOUNDS" | "ABOVE_MAXIMUM";

/** Compares a period's operational coverage (not its shift codes) with its bounds. */
export function staffingStatus(
  covered: number,
  bounds: StaffingBounds | undefined,
): StaffingStatus {
  if (bounds?.min === undefined && bounds?.max === undefined)
    return "NOT_CONFIGURED";
  if (bounds.min !== undefined && covered < bounds.min) return "BELOW_MINIMUM";
  if (bounds.max !== undefined && covered > bounds.max) return "ABOVE_MAXIMUM";
  return "WITHIN_BOUNDS";
}

type StaffingViolation = Extract<Violation, { rule: "STAFFING" }>;

/**
 * Staffing findings: an error below the minimum, a warning above the maximum.
 * Operational coverage keeps ME contributing to M and E (D42). Days and periods without a requirement are
 * not checked.
 */
export function findStaffingViolations(input: {
  readonly period: DatePeriod;
  readonly assignments: readonly Assignment[];
  readonly requirements: ReadonlyMap<IsoDate, StaffingRequirement>;
}): StaffingViolation[] {
  const violations: StaffingViolation[] = [];
  for (const [date, requirement] of input.requirements) {
    if (!isInPeriod(input.period, date)) continue;
    const coverage = coverageOf(
      countByShift(
        input.assignments.filter((a) => a.date === date).map((a) => a.shift),
      ),
    );
    for (const period of COVERAGE_PERIODS) {
      const bounds = requirement[period];
      const status = staffingStatus(coverage[period], bounds);
      if (status === "BELOW_MINIMUM" || status === "ABOVE_MAXIMUM")
        violations.push({
          rule: "STAFFING",
          severity: status === "BELOW_MINIMUM" ? "error" : "warning",
          date,
          period,
          covered: coverage[period],
          status,
          bounds: bounds!,
        });
    }
  }
  return violations;
}

/** Configured minima override the baseline of one nurse per M/E/N period. */
export function requiredStaffing(
  dates: readonly IsoDate[],
  configured: ReadonlyMap<IsoDate, StaffingRequirement>,
): ReadonlyMap<IsoDate, StaffingRequirement> {
  return new Map(
    dates.map((date) => [
      date,
      Object.fromEntries(
        COVERAGE_PERIODS.map((period) => [
          period,
          {
            ...configured.get(date)?.[period],
            min: configured.get(date)?.[period]?.min ?? 1,
          },
        ]),
      ),
    ]),
  );
}
