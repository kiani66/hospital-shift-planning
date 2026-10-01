import type { IsoDate } from "../shared/dates";
import type { BaseShift, ShiftCode } from "../shifts/shift-type";
import type { StaffingBounds } from "./staffing";

/**
 * `error` is a hard rule: it blocks FINALIZE and SUBMIT and a post-finalization
 * change that introduces it. `warning` is a soft rule: reported, never
 * blocking (e.g. staffing outside its configured bounds).
 */
export type ViolationSeverity = "error" | "warning";

export type Violation =
  | {
      /** Night on `nightDate` followed by any shift on `date` (= nightDate + 1). */
      readonly rule: "NIGHT_REST";
      readonly severity: "error";
      readonly nurseId: string;
      readonly nightDate: IsoDate;
      readonly date: IsoDate;
      readonly shift: ShiftCode;
    }
  | {
      /** More than one assignment for the same nurse and day. */
      readonly rule: "DUPLICATE_ASSIGNMENT";
      readonly severity: "error";
      readonly nurseId: string;
      readonly date: IsoDate;
    }
  | {
      /** A working-copy assignment dated outside the schedule period. */
      readonly rule: "OUTSIDE_PERIOD";
      readonly severity: "error";
      readonly nurseId: string;
      readonly date: IsoDate;
    }
  | {
      /**
       * A coverage period of `date` staffed outside its configured bounds
       * (D44). Only reported where a requirement is configured; about the
       * day's period, not one nurse.
       */
      readonly rule: "STAFFING";
      readonly severity: "warning";
      readonly date: IsoDate;
      readonly period: BaseShift;
      readonly covered: number;
      readonly status: "BELOW_MINIMUM" | "ABOVE_MAXIMUM";
      readonly bounds: StaffingBounds;
    };

export const isBlocking = (violation: Violation): boolean =>
  violation.severity === "error";

export const hasBlockingViolations = (
  violations: readonly Violation[],
): boolean => violations.some(isBlocking);

/**
 * The cells a violation is attributable to: its days and its nurse. A null
 * nurse means every nurse working that day (a staffing finding is about the
 * whole coverage period).
 */
export interface ViolationFootprint {
  readonly nurseId: string | null;
  /** Sorted; a night-rest finding spans the Night and the day after. */
  readonly dates: readonly IsoDate[];
}

export function violationFootprint(violation: Violation): ViolationFootprint {
  switch (violation.rule) {
    case "NIGHT_REST":
      return {
        nurseId: violation.nurseId,
        dates: [violation.nightDate, violation.date],
      };
    case "DUPLICATE_ASSIGNMENT":
    case "OUTSIDE_PERIOD":
      return { nurseId: violation.nurseId, dates: [violation.date] };
    case "STAFFING":
      return { nurseId: null, dates: [violation.date] };
  }
}

/** Whether the violation involves the nurse's cell on `date`. */
export function involvesCell(
  violation: Violation,
  cell: { readonly nurseId: string; readonly date: IsoDate },
): boolean {
  const { nurseId, dates } = violationFootprint(violation);
  return (
    (nurseId === null || nurseId === cell.nurseId) && dates.includes(cell.date)
  );
}

/**
 * The identity of a finding, independent of how bad it is: the same key
 * before and after a change means "the same finding". A night-rest pair keeps
 * its key when only the following day's shift changes (N→M becoming N→E is
 * not a new violation).
 */
export function violationKey(violation: Violation): string {
  const { nurseId, dates } = violationFootprint(violation);
  const subject =
    violation.rule === "STAFFING"
      ? `${violation.period}|${violation.status}`
      : nurseId;
  return [violation.rule, subject, ...dates].join("|");
}

/**
 * How far a finding is from compliant (1 for a yes/no rule; the shortfall or
 * excess for staffing). A finding with the same key and a larger magnitude
 * got worse.
 */
export function violationMagnitude(violation: Violation): number {
  if (violation.rule !== "STAFFING") return 1;
  return violation.status === "BELOW_MINIMUM"
    ? violation.bounds.min! - violation.covered
    : violation.covered - violation.bounds.max!;
}
