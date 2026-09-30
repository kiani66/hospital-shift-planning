import { validateSchedule } from "../../domain/rules/validate-schedule";
import type { Violation } from "../../domain/rules/violation";
import { addDays } from "../../domain/shared/dates";
import type { DatePeriod } from "../../domain/shared/period";
import type { Assignment } from "../../domain/shifts/assignment";
import type { DbExecutor } from "../../infrastructure/db/database";
import {
  listAdjacentAssignments,
  listAssignments,
} from "../../infrastructure/repositories/assignments";

export interface WorkingCopyValidation {
  readonly assignments: readonly Assignment[];
  /** Every rule violation involving the schedule (blocking or not), sorted. */
  readonly violations: readonly Violation[];
}

/**
 * The one validation path for a schedule's working copy: its assignments
 * plus the neighbouring schedules' boundary days of the same department
 * (night-rest holds across schedule boundaries, D7, D20), through the
 * domain's `validateSchedule`. The monthly review shows the result; FINALIZE
 * and SUBMIT are gated by it (inside their transaction, after the row lock,
 * so nothing validated can change before the transition commits). Two
 * queries, independent of department size.
 */
export async function validateWorkingCopy(
  db: DbExecutor,
  schedule: {
    readonly id: string;
    readonly departmentId: string;
    readonly period: DatePeriod;
  },
): Promise<WorkingCopyValidation> {
  const { period } = schedule;
  const assignments = await listAssignments(db, schedule.id);
  const adjacent = await listAdjacentAssignments(db, {
    departmentId: schedule.departmentId,
    excludeScheduleId: schedule.id,
    nurseIds: [...new Set(assignments.map((a) => a.nurseId))],
    dates: [addDays(period.start, -1), addDays(period.end, 1)],
  });
  return {
    assignments,
    violations: validateSchedule({
      period,
      assignments,
      adjacentAssignments: adjacent,
    }),
  };
}
