import {
  compareIsoDates,
  uniqueSortedDates,
  type IsoDate,
} from "../shared/dates";
import { InvalidStateError, ValidationError } from "../shared/errors";
import { err, ok, type Result } from "../shared/result";
import type { Assignment } from "../shifts/assignment";
import type { ShiftCode } from "../shifts/shift-type";
import {
  assignmentKey,
  type AssignmentChange,
  type AssignmentEdit,
} from "./assignment-editing";
import type { ScheduleStatus } from "./status";

/**
 * Where a post-finalization change (an applied change request or a Head
 * Nurse adjustment) is written:
 *
 * - WORKING_COPY: a schedule never approved (FINALIZED, first-cycle
 *   RETURNED): the working copy, whose whole period is still editable.
 * - START_REVISION: an APPROVED schedule is never edited in place; a
 *   revision is opened (APPROVED → REVISING) scoped to the changed days.
 * - EXTEND_REVISION: a revision is already open (REVISING, or a returned
 *   revision); the changed days are added to its scope.
 *
 * The approved versions themselves are never touched: the revision is
 * submitted and approved like any submission, and the newest approved
 * version becomes the executable schedule.
 */
export type ScheduleChangeMode =
  "WORKING_COPY" | "START_REVISION" | "EXTEND_REVISION";

export interface ScheduleChangeTarget {
  readonly mode: ScheduleChangeMode;
  /** The schedule status the edits are planned in (REVISING after a start). */
  readonly status: ScheduleStatus;
  /** The revision scope the edits are planned against; null without a revision. */
  readonly revisionDates: ReadonlySet<IsoDate> | null;
  /** Days added to the revision scope by this change (each one audited), sorted. */
  readonly addedRevisionDates: readonly IsoDate[];
}

/** `InvalidStateError.attempted` values of a refused post-finalization change. */
export const SCHEDULE_CHANGE_REFUSALS = {
  /** DRAFT / PLANNING: the schedule is still planned with the editor. */
  NOT_FINALIZED: "CHANGE_BEFORE_FINALIZATION",
  /** SUBMITTED: frozen while the Supervisor reviews it; withdraw first (D10). */
  SUBMITTED: "CHANGE_WHILE_SUBMITTED",
} as const;

/**
 * Decides where a change of `dates` goes, or why it may not be made. The
 * days must not be in the past (historical correction is out of scope).
 * Adding a changed day to the revision scope is explicit and per day, never
 * the whole month (D14).
 */
export function planChangeTarget(input: {
  readonly status: ScheduleStatus;
  readonly hasApprovedVersion: boolean;
  /** Scope of the open revision, null when none is open. */
  readonly openRevisionDates: ReadonlySet<IsoDate> | null;
  readonly dates: readonly IsoDate[];
  readonly today: IsoDate;
}): Result<ScheduleChangeTarget, InvalidStateError | ValidationError> {
  const { status } = input;
  const dates = uniqueSortedDates(input.dates);
  switch (status) {
    case "DRAFT":
    case "PLANNING":
      return err(
        new InvalidStateError(status, SCHEDULE_CHANGE_REFUSALS.NOT_FINALIZED),
      );
    case "SUBMITTED":
      return err(
        new InvalidStateError(status, SCHEDULE_CHANGE_REFUSALS.SUBMITTED),
      );
  }
  if (dates.some((d) => compareIsoDates(d, input.today) < 0))
    return err(
      new ValidationError("Past days cannot be changed any more", "date"),
    );

  const revisionOpen =
    status === "REVISING" ||
    (status === "RETURNED" && input.hasApprovedVersion);
  if (status === "APPROVED")
    return ok({
      mode: "START_REVISION",
      status: "REVISING",
      revisionDates: new Set(dates),
      addedRevisionDates: dates,
    });
  if (revisionOpen) {
    const scope = input.openRevisionDates ?? new Set<IsoDate>();
    const added = dates.filter((d) => !scope.has(d));
    return ok({
      mode: "EXTEND_REVISION",
      status,
      revisionDates: new Set([...scope, ...added]),
      addedRevisionDates: added,
    });
  }
  return ok({
    mode: "WORKING_COPY",
    status,
    revisionDates: null,
    addedRevisionDates: [],
  });
}

/** The assignments after `edits` (null clears a cell); used to validate a change before writing it. */
export function applyAssignmentEdits(
  assignments: readonly Assignment[],
  edits: readonly AssignmentEdit[],
): Assignment[] {
  const byKey = new Map(
    assignments.map((a) => [assignmentKey(a.nurseId, a.date), a]),
  );
  for (const e of edits) {
    const key = assignmentKey(e.nurseId, e.date);
    if (e.shift === null) byKey.delete(key);
    else byKey.set(key, { nurseId: e.nurseId, date: e.date, shift: e.shift });
  }
  return [...byKey.values()];
}

/**
 * Discarding a revision (DISCARD_REVISION) restores the working copy to the
 * latest approved version: every cell that differs from it goes back to the
 * approved value (only revision days can differ, D14, but the whole working
 * copy is compared so nothing unapproved survives). Returns the changes,
 * with the replaced values, sorted by day and nurse.
 */
export function planRevisionDiscard(input: {
  readonly working: readonly Assignment[];
  readonly approved: readonly Assignment[];
}): AssignmentChange[] {
  const toMap = (as: readonly Assignment[]) =>
    new Map<string, Assignment>(
      as.map((a) => [assignmentKey(a.nurseId, a.date), a]),
    );
  const working = toMap(input.working);
  const approved = toMap(input.approved);
  const changes: AssignmentChange[] = [];
  for (const key of new Set([...working.keys(), ...approved.keys()])) {
    const cell = (working.get(key) ?? approved.get(key))!;
    const before: ShiftCode | null = working.get(key)?.shift ?? null;
    const after: ShiftCode | null = approved.get(key)?.shift ?? null;
    if (before !== after)
      changes.push({ nurseId: cell.nurseId, date: cell.date, before, after });
  }
  return changes.sort(
    (a, b) =>
      compareIsoDates(a.date, b.date) || a.nurseId.localeCompare(b.nurseId),
  );
}
