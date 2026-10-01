import type { IsoDate } from "../shared/dates";
import { isInPeriod, type DatePeriod } from "../shared/period";
import type { Assignment } from "../shifts/assignment";
import { countByShift, coverageOf } from "../shifts/coverage";
import { COVERAGE_PERIODS, type BaseShift } from "../shifts/shift-type";
import type { Violation } from "./violation";

/**
 * Staffing capacity boundary (Phase 7a). The numbers are a business decision
 * not yet made: no minimum or maximum exists anywhere, so every period reads
 * NOT_CONFIGURED. Requirements come from a source per department and day
 * (`StaffingRequirementsSource`); `findStaffingViolations` reports a period
 * outside its bounds as a `warning` (never blocking, D44), so nothing is
 * reported while no source configures numbers.
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
 * Staffing findings of the period's days: one `warning` per coverage period
 * whose operational coverage (ME counts toward M and E, D42) is below its
 * minimum or above its maximum. Days and periods without a requirement are
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
          severity: "warning",
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
