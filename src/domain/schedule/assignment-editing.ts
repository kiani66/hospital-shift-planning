import type { IsoDate } from "../shared/dates";
import { allow, deny, type Decision } from "../shared/decision";
import { InvalidStateError, ValidationError } from "../shared/errors";
import { isInPeriod, type DatePeriod } from "../shared/period";
import { err, ok, type Result } from "../shared/result";
import type { AssignmentCode } from "../shifts/shift-type";
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
 * Statuses in which no assignment may change at all: awaiting the
 * Supervisor (SUBMITTED) or closed (APPROVED; changes need a revision).
 */
export const assignmentsLockedIn = (status: ScheduleStatus): boolean =>
  status === "SUBMITTED" || status === "APPROVED";

/**
 * Whether the Head Nurse may change the assignment for `date` given the
 * schedule's state (authorization is checked separately by the policies).
 */
export function canEditAssignment(
  ctx: AssignmentEditContext,
): Decision<AssignmentEditDenial> {
  if (!isInPeriod(ctx.period, ctx.date)) return deny("DATE_OUTSIDE_PERIOD");

  if (assignmentsLockedIn(ctx.status)) return deny("SCHEDULE_LOCKED");
  switch (ctx.status) {
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

/** One requested cell: the nurse's shift on `date`, or null for "undecided" (clear). */
export interface AssignmentEdit {
  readonly nurseId: string;
  readonly date: IsoDate;
  readonly shift: AssignmentCode | null;
}

/** An edit that changes the working copy, with the value it replaces. */
export interface AssignmentChange {
  readonly nurseId: string;
  readonly date: IsoDate;
  readonly before: AssignmentCode | null;
  readonly after: AssignmentCode | null;
}

export type AssignmentPlanError = ValidationError | InvalidStateError;

/** `InvalidStateError.attempted` values of a refused edit (stable, machine-readable). */
export const ASSIGNMENT_EDIT_REFUSALS = {
  SCHEDULE_LOCKED: "EDIT_ASSIGNMENT",
  DATE_OUTSIDE_REVISION_SCOPE: "EDIT_ASSIGNMENT_OUTSIDE_REVISION_SCOPE",
} as const;

export const assignmentKey = (nurseId: string, date: IsoDate) =>
  `${nurseId}|${date}`;

/**
 * Turns requested edits into the changes to persist, or explains why none
 * may be made. All or nothing: one refused cell refuses the whole request.
 *
 * - Every nurse must be on the schedule roster (the roster snapshot, D21;
 *   roster membership is never changed by an edit).
 * - Every date must be editable in the schedule's state (`canEditAssignment`:
 *   period, locked statuses, revision scope D14).
 * - A nurse and date may appear once per request (one assignment per day, D15).
 * - Edits that repeat the stored value are dropped, so repeating a request is
 *   a no-op.
 *
 * Scheduling rules (night rest, D7) are deliberately not applied: violations
 * are allowed while editing and are reported by validation; they block only
 * FINALIZE and SUBMIT.
 */
export function planAssignmentEdits(input: {
  readonly edits: readonly AssignmentEdit[];
  /** The stored shift of each nurse and day (`assignmentKey`); absent = none. */
  readonly current: ReadonlyMap<string, AssignmentCode>;
  readonly rosterNurseIds: ReadonlySet<string>;
  readonly schedule: Omit<AssignmentEditContext, "date">;
}): Result<AssignmentChange[], AssignmentPlanError> {
  const { edits, current, rosterNurseIds, schedule } = input;
  if (edits.length === 0)
    return err(new ValidationError("No assignment to change", "changes"));

  const seen = new Set<string>();
  for (const edit of edits) {
    const key = assignmentKey(edit.nurseId, edit.date);
    if (seen.has(key))
      return err(
        new ValidationError(
          "The same nurse and day appear more than once",
          "changes",
        ),
      );
    seen.add(key);
    if (!rosterNurseIds.has(edit.nurseId))
      return err(
        new ValidationError(
          "The nurse is not on the schedule roster",
          "nurseId",
        ),
      );
    const decision = canEditAssignment({ ...schedule, date: edit.date });
    if (!decision.allowed) {
      if (decision.reason === "DATE_OUTSIDE_PERIOD")
        return err(
          new ValidationError(
            "The date is outside the schedule period",
            "date",
          ),
        );
      return err(
        new InvalidStateError(
          schedule.status,
          ASSIGNMENT_EDIT_REFUSALS[decision.reason],
        ),
      );
    }
  }

  return ok(
    edits
      .map((edit) => ({
        nurseId: edit.nurseId,
        date: edit.date,
        before: current.get(assignmentKey(edit.nurseId, edit.date)) ?? null,
        after: edit.shift,
      }))
      .filter((change) => change.before !== change.after),
  );
}

/** The edits that restore what `changes` replaced (undo). */
export const revertChanges = (
  changes: readonly AssignmentChange[],
): AssignmentEdit[] =>
  changes.map((c) => ({ nurseId: c.nurseId, date: c.date, shift: c.before }));
