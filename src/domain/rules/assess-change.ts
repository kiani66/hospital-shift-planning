import type { IsoDate } from "../shared/dates";
import { uniqueSortedDates } from "../shared/dates";
import type { Assignment } from "../shifts/assignment";
import { countByShift, coverageOf } from "../shifts/coverage";
import { COVERAGE_PERIODS, type BaseShift } from "../shifts/shift-type";
import {
  staffingStatus,
  type StaffingBounds,
  type StaffingRequirement,
  type StaffingStatus,
} from "./staffing";
import {
  involvesCell,
  isBlocking,
  violationKey,
  violationMagnitude,
  type Violation,
} from "./violation";

/** A cell a proposed change writes. */
export interface ChangedCell {
  readonly nurseId: string;
  readonly date: IsoDate;
}

export interface ChangeAssessment {
  /**
   * Findings the change introduces or worsens that are attributable to the
   * changed cells, sorted as the validator sorts them.
   */
  readonly introduced: readonly Violation[];
  /** The `error`-severity part of `introduced`: hard rules; they block the change. */
  readonly blocking: readonly Violation[];
  /** The `warning`-severity part of `introduced`: soft rules; shown, never blocking. */
  readonly warnings: readonly Violation[];
  /**
   * Findings attributable to the changed cells that already existed and are
   * not worse (context for the Head Nurse; they do not block).
   */
  readonly persisting: readonly Violation[];
  readonly blocked: boolean;
}

/**
 * Compares the findings of the destination schedule before and after a
 * proposed change. The invariant: a change must not introduce or worsen a
 * hard violation attributable to the changed cells; pre-existing unrelated
 * violations do not block it. Severity alone decides blocking (`isBlocking`):
 * errors are hard rules, warnings are soft. "The same finding" is
 * `violationKey`; "worse" is a larger `violationMagnitude`.
 */
export function assessChange(input: {
  readonly before: readonly Violation[];
  readonly after: readonly Violation[];
  readonly changedCells: readonly ChangedCell[];
}): ChangeAssessment {
  const previous = new Map<string, number>();
  for (const v of input.before) {
    const key = violationKey(v);
    previous.set(key, Math.max(previous.get(key) ?? 0, violationMagnitude(v)));
  }
  const attributable = input.after.filter((v) =>
    input.changedCells.some((cell) => involvesCell(v, cell)),
  );
  const isNewOrWorse = (v: Violation) => {
    const before = previous.get(violationKey(v));
    return before === undefined || violationMagnitude(v) > before;
  };
  const introduced = attributable.filter(isNewOrWorse);
  const blocking = introduced.filter(isBlocking);
  return {
    introduced,
    blocking,
    warnings: introduced.filter((v) => !isBlocking(v)),
    persisting: attributable.filter((v) => !isNewOrWorse(v)),
    blocked: blocking.length > 0,
  };
}

export interface PeriodImpact {
  readonly period: BaseShift;
  readonly before: number;
  readonly after: number;
  readonly bounds: StaffingBounds | null;
  /** The status after the change; NOT_CONFIGURED while no numbers exist (D44). */
  readonly status: StaffingStatus;
}

export interface DayStaffingImpact {
  readonly date: IsoDate;
  readonly periods: readonly PeriodImpact[];
}

/**
 * Operational coverage of the changed days before and after a change, per
 * coverage period (ME counts toward M and E, D42), with the staffing status
 * after it. A summary for the decision; staffing findings themselves come
 * from validation.
 */
export function staffingImpact(input: {
  readonly before: readonly Assignment[];
  readonly after: readonly Assignment[];
  readonly dates: readonly IsoDate[];
  readonly requirements?: ReadonlyMap<IsoDate, StaffingRequirement>;
}): DayStaffingImpact[] {
  const coverage = (assignments: readonly Assignment[], date: IsoDate) =>
    coverageOf(
      countByShift(
        assignments.filter((a) => a.date === date).map((a) => a.shift),
      ),
    );
  return uniqueSortedDates(input.dates).map((date) => {
    const before = coverage(input.before, date);
    const after = coverage(input.after, date);
    const requirement = input.requirements?.get(date);
    return {
      date,
      periods: COVERAGE_PERIODS.map((period) => {
        const bounds = requirement?.[period] ?? null;
        return {
          period,
          before: before[period],
          after: after[period],
          bounds,
          status: staffingStatus(after[period], bounds ?? undefined),
        };
      }),
    };
  });
}
