import { addDays, compareIsoDates } from "../shared/dates";
import { isInPeriod, type DatePeriod } from "../shared/period";
import type { Assignment } from "../shifts/assignment";
import { findNightRestViolations } from "./night-rest";
import type { Violation } from "./violation";

export interface ScheduleValidationInput {
  readonly period: DatePeriod;
  /** The schedule's working-copy assignments. */
  readonly assignments: readonly Assignment[];
  /**
   * Assignments from neighbouring schedules for the same nurses; at minimum the
   * day before `period.start` and the day after `period.end`. Used only as
   * context for cross-boundary rules; never reported on their own.
   */
  readonly adjacentAssignments?: readonly Assignment[];
}

/**
 * All rule violations that involve this schedule, sorted by date then nurse.
 * Violations may exist while planning; `hasBlockingViolations` gates FINALIZE/SUBMIT.
 */
export function validateSchedule(input: ScheduleValidationInput): Violation[] {
  const { period, assignments } = input;
  const violations: Violation[] = [];

  const seen = new Set<string>();
  for (const a of assignments) {
    if (!isInPeriod(period, a.date)) {
      violations.push({
        rule: "OUTSIDE_PERIOD",
        severity: "error",
        nurseId: a.nurseId,
        date: a.date,
      });
    }
    const k = `${a.nurseId}|${a.date}`;
    if (seen.has(k)) {
      violations.push({
        rule: "DUPLICATE_ASSIGNMENT",
        severity: "error",
        nurseId: a.nurseId,
        date: a.date,
      });
    }
    seen.add(k);
  }

  // Only the days touching the boundary matter for the night-rest rule.
  const dayBefore = addDays(period.start, -1);
  const dayAfter = addDays(period.end, 1);
  const context = (input.adjacentAssignments ?? []).filter(
    (a) => a.date === dayBefore || a.date === dayAfter,
  );

  for (const v of findNightRestViolations([...assignments, ...context])) {
    // Report when either side of the pair lies in this period (both schedules own it).
    if (isInPeriod(period, v.nightDate) || isInPeriod(period, v.date))
      violations.push(v);
  }

  return violations.sort(
    (a, b) =>
      compareIsoDates(a.date, b.date) ||
      a.nurseId.localeCompare(b.nurseId) ||
      a.rule.localeCompare(b.rule),
  );
}
