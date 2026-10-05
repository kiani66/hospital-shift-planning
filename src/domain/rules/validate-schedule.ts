import { addDays, compareIsoDates, type IsoDate } from "../shared/dates";
import { isInPeriod, periodDays, type DatePeriod } from "../shared/period";
import type { Assignment } from "../shifts/assignment";
import { findNightRestViolations } from "./night-rest";
import { findStaffingViolations, type StaffingRequirement } from "./staffing";
import { violationFootprint, type Violation } from "./violation";

export interface ScheduleValidationInput {
  readonly period: DatePeriod;
  /** The schedule's working-copy assignments. */
  readonly assignments: readonly Assignment[];
  /** Roster snapshot: every rostered nurse requires a decision on every period day. */
  readonly rosterNurseIds?: readonly string[];
  /**
   * Assignments from neighbouring schedules for the same nurses; at minimum the
   * day before `period.start` and the day after `period.end`. Used only as
   * context for cross-boundary rules; never reported on their own.
   */
  readonly adjacentAssignments?: readonly Assignment[];
  /**
   * Configured staffing bounds per day (D44); days without an entry are not
   * checked. Minimum shortfalls block; maximum excesses remain warnings.
   */
  readonly staffingRequirements?: ReadonlyMap<IsoDate, StaffingRequirement>;
}

/**
 * All rule violations that involve this schedule, sorted by date then nurse.
 * Violations may exist while planning; `hasBlockingViolations` gates FINALIZE/SUBMIT
 * (errors only; staffing maximum warnings never block).
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

  if (input.rosterNurseIds) {
    for (const date of periodDays(period)) {
      for (const nurseId of input.rosterNurseIds) {
        if (!seen.has(`${nurseId}|${date}`))
          violations.push({
            rule: "UNDECIDED",
            severity: "error",
            nurseId,
            date,
          });
      }
    }
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

  if (input.staffingRequirements)
    violations.push(
      ...findStaffingViolations({
        period,
        assignments,
        requirements: input.staffingRequirements,
      }),
    );

  const nurseOf = (v: Violation) => violationFootprint(v).nurseId ?? "";
  return violations.sort(
    (a, b) =>
      compareIsoDates(a.date, b.date) ||
      nurseOf(a).localeCompare(nurseOf(b)) ||
      a.rule.localeCompare(b.rule) ||
      (a.rule === "STAFFING" && b.rule === "STAFFING"
        ? a.period.localeCompare(b.period)
        : 0),
  );
}
