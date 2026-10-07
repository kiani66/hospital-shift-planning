import type { IsoDate } from "../shared/dates";
import { isInPeriod, type DatePeriod } from "../shared/period";
import {
  summarizeValidation,
  type DayValidation,
  type ValidationSummary,
} from "../rules/validation-summary";
import type { Violation } from "../rules/violation";
import {
  countByShift,
  coverageOf,
  type CoverageCounts,
  type ShiftCounts,
} from "../shifts/coverage";
import type { Assignment } from "../shifts/assignment";
import type { AssignmentCode } from "../shifts/shift-type";

/**
 * What a month overview needs for one day (D47, D103): its validation
 * categories and primary state, assignment counts and operational coverage.
 * Counts, never people. Independent of whether the day is a holiday.
 */
export interface ScheduleDaySummary extends DayValidation {
  /** Assignments by type (ME is its own type; OFF is not a shift). */
  readonly shifts: ShiftCounts;
  /** Operational coverage per period (ME counts toward M and E, OFF toward none). */
  readonly coverage: CoverageCounts;
}

export interface ScheduleDaysSummary {
  readonly days: readonly ScheduleDaySummary[];
  /** The month's counts per category, readiness and unattributed findings. */
  readonly validation: ValidationSummary;
}

/** Summarizes every day of the period from the assignments and their violations. */
export function summarizeScheduleDays(input: {
  readonly period: DatePeriod;
  readonly assignments: readonly Assignment[];
  readonly violations: readonly Violation[];
}): ScheduleDaysSummary {
  const validation = summarizeValidation(input);
  const shiftsByDay = new Map<IsoDate, AssignmentCode[]>();
  for (const a of input.assignments) {
    if (!isInPeriod(input.period, a.date)) continue;
    shiftsByDay.set(a.date, [...(shiftsByDay.get(a.date) ?? []), a.shift]);
  }
  const days = validation.days.map((day): ScheduleDaySummary => {
    const shifts = countByShift(shiftsByDay.get(day.date) ?? []);
    return { ...day, shifts, coverage: coverageOf(shifts) };
  });
  return { days, validation };
}
