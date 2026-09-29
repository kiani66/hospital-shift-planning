import type { IsoDate } from "../shared/dates";
import type { ShiftCode } from "../shifts/shift-type";

/** `error` blocks FINALIZE and SUBMIT; `warning` is informational (e.g. future staffing rules). */
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
    };

export const isBlocking = (violation: Violation): boolean =>
  violation.severity === "error";

export const hasBlockingViolations = (
  violations: readonly Violation[],
): boolean => violations.some(isBlocking);
