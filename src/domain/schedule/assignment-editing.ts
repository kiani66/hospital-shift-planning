import type { IsoDate } from "../shared/dates";
import { allow, deny, type Decision } from "../shared/decision";
import { isInPeriod, type DatePeriod } from "../shared/period";
import type { ScheduleStatus } from "./status";

export type AssignmentEditDenial =
  "DATE_OUTSIDE_PERIOD" | "SCHEDULE_LOCKED" | "DATE_OUTSIDE_REVISION_SCOPE";

export interface AssignmentEditContext {
  readonly status: ScheduleStatus;
  readonly period: DatePeriod;
  readonly date: IsoDate;
  /**
   * Dates of the open revision of an approved schedule, or null when there is
   * none. Once a schedule has been approved, edits are limited to this scope.
   */
  readonly revisionDates: ReadonlySet<IsoDate> | null;
}

/**
 * Whether the Head Nurse may change the assignment for `date` given the
 * schedule's state (authorization is checked separately by the policies).
 */
export function canEditAssignment(
  ctx: AssignmentEditContext,
): Decision<AssignmentEditDenial> {
  if (!isInPeriod(ctx.period, ctx.date)) return deny("DATE_OUTSIDE_PERIOD");

  switch (ctx.status) {
    case "SUBMITTED":
    case "APPROVED":
      return deny("SCHEDULE_LOCKED");
    case "REVISING":
    case "RETURNED": {
      // Once approved, edits are limited to the revision scope. A first-cycle
      // RETURNED (no revision) leaves the whole period editable.
      const scoped = ctx.status === "REVISING" || ctx.revisionDates !== null;
      return scoped && !ctx.revisionDates?.has(ctx.date)
        ? deny("DATE_OUTSIDE_REVISION_SCOPE")
        : allow;
    }
    default:
      return allow;
  }
}
