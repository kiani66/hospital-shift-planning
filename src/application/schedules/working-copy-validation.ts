import type { StaffingRequirement } from "../../domain/rules/staffing";
import { validateSchedule } from "../../domain/rules/validate-schedule";
import type { Violation } from "../../domain/rules/violation";
import { addDays, type IsoDate } from "../../domain/shared/dates";
import { periodDays, type DatePeriod } from "../../domain/shared/period";
import type { Assignment } from "../../domain/shifts/assignment";
import type { DbExecutor } from "../../infrastructure/db/database";
import {
  listAdjacentAssignments,
  listRosterAssignments,
} from "../../infrastructure/repositories/assignments";
import type { RosterEntry } from "../../infrastructure/repositories/roster";
import { NO_HOLIDAY_DATA, type HolidayCalendar } from "../calendar/holidays";
import {
  holidayDates,
  loadRuleSet,
  requirementsUnder,
  type LoadedRuleSet,
} from "../staffing-rules/pinned";

/** What validation needs from a schedule row. */
export interface ValidatedSchedule {
  readonly id: string;
  readonly departmentId: string;
  readonly period: DatePeriod;
  /** The pinned rule-set version (D106). */
  readonly staffingRuleSetVersionId: string;
}

/** The working copy and its context, loaded once (validate it under any version). */
export interface LoadedWorkingCopy {
  readonly assignments: readonly Assignment[];
  readonly roster: readonly RosterEntry[];
  /** The neighbouring schedules' boundary days (night rest across periods). */
  readonly adjacent: readonly Assignment[];
  readonly holidays: ReadonlySet<IsoDate>;
}

export interface WorkingCopyValidation extends LoadedWorkingCopy {
  /** Every rule violation involving the schedule (blocking or not), sorted. */
  readonly violations: readonly Violation[];
  /** The pinned version the requirements come from. */
  readonly ruleSet: LoadedRuleSet;
  readonly requirements: ReadonlyMap<IsoDate, StaffingRequirement>;
}

/**
 * Loads a working copy with the neighbouring schedules' boundary days of the
 * same department and the period's holidays. Two queries plus the holiday
 * port, independent of department size.
 */
export async function loadWorkingCopy(
  db: DbExecutor,
  schedule: ValidatedSchedule,
  holidays: HolidayCalendar,
): Promise<LoadedWorkingCopy> {
  const { period } = schedule;
  const [{ assignments, roster }, holidaySet] = await Promise.all([
    listRosterAssignments(db, schedule.id),
    holidayDates(holidays, period),
  ]);
  const adjacent = await listAdjacentAssignments(db, {
    departmentId: schedule.departmentId,
    excludeScheduleId: schedule.id,
    nurseIds: [...new Set(assignments.map((a) => a.nurseId))],
    dates: [addDays(period.start, -1), addDays(period.end, 1)],
  });
  return { assignments, roster, adjacent, holidays: holidaySet };
}

/** Validates a loaded working copy under one rule-set version. Pure. */
export function validateUnder(
  schedule: ValidatedSchedule,
  loaded: LoadedWorkingCopy,
  ruleSet: LoadedRuleSet,
): {
  readonly violations: Violation[];
  readonly requirements: ReadonlyMap<IsoDate, StaffingRequirement>;
} {
  const requirements = requirementsUnder(
    ruleSet,
    periodDays(schedule.period),
    loaded.holidays,
  );
  return {
    requirements,
    violations: validateSchedule({
      period: schedule.period,
      assignments: loaded.assignments,
      adjacentAssignments: loaded.adjacent,
      rosterNurseIds: loaded.roster.map((r) => r.userId),
      staffingRequirements: requirements,
    }),
  };
}

/**
 * The one validation path for a schedule's working copy: its assignments
 * plus the neighbouring schedules' boundary days (night rest across schedule
 * boundaries, D7, D20), against the staffing bounds of the schedule's PINNED
 * rule-set version (D106), never "the latest rules". The monthly review
 * shows the result; FINALIZE and SUBMIT are gated by it (inside their
 * transaction, after the row lock).
 */
export async function validateWorkingCopy(
  db: DbExecutor,
  schedule: ValidatedSchedule,
  holidays: HolidayCalendar = NO_HOLIDAY_DATA,
): Promise<WorkingCopyValidation> {
  const [loaded, ruleSet] = await Promise.all([
    loadWorkingCopy(db, schedule, holidays),
    loadRuleSet(db, schedule.staffingRuleSetVersionId),
  ]);
  return { ...loaded, ruleSet, ...validateUnder(schedule, loaded, ruleSet) };
}
