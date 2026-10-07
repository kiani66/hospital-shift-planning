import { z } from "zod";

import {
  assignmentKey,
  planAssignmentEdits,
  type AssignmentChange,
} from "../../domain/schedule/assignment-editing";
import { isIsoDate, type IsoDate } from "../../domain/shared/dates";
import { ValidationError } from "../../domain/shared/errors";
import { lockActiveSchedulingUsers } from "../../infrastructure/repositories/management";
import { MAX_PERIOD_DAYS } from "../../domain/shared/period";
import { unwrap } from "../../domain/shared/result";
import { ASSIGNMENT_CODES } from "../../domain/shifts/shift-type";
import {
  clearAssignment,
  listAssignmentsFor,
  setAssignment,
} from "../../infrastructure/repositories/assignments";
import { findOpenRevision } from "../../infrastructure/repositories/revisions";
import { listRoster } from "../../infrastructure/repositories/roster";
import type { ScheduleRecord } from "../../infrastructure/repositories/schedules";
import { ConflictError } from "../errors";
import { defineCommand, type UnitOfWork } from "../use-case";
import { loadScheduleForUpdate, saveSchedule } from "./load-for-update";

const isoDateInput = z
  .string()
  .refine(isIsoDate, "Expected a YYYY-MM-DD date")
  .transform((value) => value as IsoDate);

/**
 * One cell per change: the nurse's shift on the date, or null to clear it
 * (undecided; the nurse stays on the roster). A single edit is a request of
 * one change; a range edit (one nurse, several days) is bounded by the
 * longest period.
 */
export const setAssignmentsInput = z.object({
  scheduleId: z.uuid(),
  /** The schedule revision the caller saw (optimistic concurrency, D30). */
  expectedRevision: z.number().int().nonnegative(),
  changes: z
    .array(
      z.object({
        nurseId: z.uuid(),
        date: isoDateInput,
        shift: z.enum(ASSIGNMENT_CODES).nullable(),
      }),
    )
    .min(1)
    .max(MAX_PERIOD_DAYS),
});

export interface SetAssignmentsOutput {
  /** The schedule revision after the request; send it with the next edit. */
  readonly revision: number;
  /** What changed, with the replaced values (empty when the request repeated the stored state). */
  readonly changes: readonly AssignmentChange[];
}

/** The audit action of one changed cell (also used by post-finalization changes). */
export const assignmentAuditAction = (change: AssignmentChange) =>
  change.before === null
    ? "assignment.created"
    : change.after === null
      ? "assignment.cleared"
      : "assignment.changed";

/**
 * The Head Nurse sets, changes or clears shifts in the schedule's working
 * copy (`shift_assignments`). One transaction:
 *
 * 1. lock the schedule row (`FOR UPDATE`), so every edit of this schedule is
 *    serialized and the stored cells read below cannot change underneath;
 * 2. authorize `assignment.edit` for the schedule's department (a Head Nurse
 *    of that department; the request's own claims are never trusted);
 * 3. plan in the domain: roster, period, status and revision scope (D14);
 *    edits repeating the stored value are dropped;
 * 4. nothing to change → success without writing (a retried request is
 *    harmless, whatever revision it carries);
 * 5. otherwise the caller's revision must be current (a stale tab gets
 *    CONFLICT instead of overwriting newer work), then write, audit every
 *    changed cell and bump the revision.
 *
 * Night-rest and the other rules are not enforced here: violations are
 * allowed while editing (D7) and show up in the review, which re-validates
 * the whole schedule, so neighbouring days never stay stale. Roster
 * membership, preferences and the status never change.
 */
export const setAssignments = defineCommand({
  name: "assignment.set",
  input: setAssignmentsInput,
  async handler(uow, input): Promise<SetAssignmentsOutput> {
    const schedule = await loadScheduleForUpdate(uow, input.scheduleId);
    uow.authorize("assignment.edit", { departmentId: schedule.departmentId });

    const nurseIds = [...new Set(input.changes.map((c) => c.nurseId))];
    const dates = [...new Set(input.changes.map((c) => c.date))];
    const revisionScoped =
      schedule.status === "REVISING" || schedule.status === "RETURNED";
    const [roster, stored, revision] = await Promise.all([
      listRoster(uow.tx, schedule.id),
      listAssignmentsFor(uow.tx, { scheduleId: schedule.id, nurseIds, dates }),
      revisionScoped ? findOpenRevision(uow.tx, schedule.id) : null,
    ]);

    const changes = unwrap(
      planAssignmentEdits({
        edits: input.changes,
        current: new Map(
          stored.map((a) => [assignmentKey(a.nurseId, a.date), a.shift]),
        ),
        rosterNurseIds: new Set(roster.map((r) => r.userId)),
        schedule: {
          status: schedule.status,
          period: schedule.period,
          revisionDates: revision ? new Set(revision.dates) : null,
        },
      }),
    );
    if (changes.length === 0) return { revision: schedule.revision, changes };
    if (
      !(await lockActiveSchedulingUsers(
        uow.tx,
        changes.filter((c) => c.after !== null).map((c) => c.nurseId),
      ))
    )
      throw new ValidationError(
        "Inactive accounts cannot receive new assignments",
        "nurseId",
      );
    // Checked after authorizing, so an outsider learns nothing from CONFLICT.
    if (schedule.revision !== input.expectedRevision) throw new ConflictError();

    await writeAssignmentChanges(uow, schedule, changes);
    const saved = await saveSchedule(uow, schedule, {});
    return { revision: saved.revision, changes };
  },
});

/**
 * Writes planned changes to the working copy of a locked schedule, each cell
 * in place (one decision per nurse and day, D15: an OFF decision is replaced,
 * never kept beside a shift) and audited on its own (D48). Shared by the
 * planning editor and the candidate command (D111), so both persist and
 * audit an assignment the same way. The caller authorizes, checks and saves.
 */
export async function writeAssignmentChanges(
  uow: UnitOfWork,
  schedule: ScheduleRecord,
  changes: readonly AssignmentChange[],
): Promise<void> {
  for (const change of changes) {
    const cell = {
      scheduleId: schedule.id,
      userId: change.nurseId,
      date: change.date,
    };
    if (change.after === null) await clearAssignment(uow.tx, cell);
    else
      await setAssignment(uow.tx, {
        ...cell,
        shift: change.after,
        updatedBy: uow.actor.userId,
      });
    await uow.audit({
      action: assignmentAuditAction(change),
      entityType: "assignment",
      entityId: `${change.nurseId}:${change.date}`,
      departmentId: schedule.departmentId,
      scheduleId: schedule.id,
      data: {
        date: change.date,
        nurseId: change.nurseId,
        before: change.before,
        after: change.after,
        ...(changes.length > 1 && { batchSize: changes.length }),
      },
    });
  }
}
