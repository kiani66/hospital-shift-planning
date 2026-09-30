import type { IsoDate } from "../shared/dates";
import { isInPeriod, periodDays, type DatePeriod } from "../shared/period";
import type { Diagnostic } from "../rules/diagnostic";
import {
  countByShift,
  coverageOf,
  type CoverageCounts,
  type ShiftCounts,
} from "../shifts/coverage";
import type { Assignment } from "../shifts/assignment";
import type { ShiftCode } from "../shifts/shift-type";

/**
 * A day's high-level review state. Semantic only: colors, icons and wording
 * are presentation. Independent of whether the day is a holiday.
 *
 * - UNPLANNED: nothing is assigned yet, so the day cannot meaningfully be
 *   called valid or invalid.
 * - NEEDS_ATTENTION: at least one finding of an applicable rule.
 * - VALID: assignments exist and every applicable rule passes. Only the rules
 *   that exist are applied; staffing rules do not exist yet (see
 *   `rules/staffing.ts`), so VALID does not claim the day is fully staffed.
 */
export const DAY_HEALTH_STATES = [
  "UNPLANNED",
  "VALID",
  "NEEDS_ATTENTION",
] as const;

export type DayHealth = (typeof DAY_HEALTH_STATES)[number];

export function dayHealth(day: {
  readonly assignmentCount: number;
  readonly findingCount: number;
}): DayHealth {
  if (day.assignmentCount === 0) return "UNPLANNED";
  return day.findingCount > 0 ? "NEEDS_ATTENTION" : "VALID";
}

/** The aggregate a month overview needs for one day: counts, never people. */
export interface ScheduleDaySummary {
  readonly date: IsoDate;
  readonly health: DayHealth;
  /** Assignments by type (ME is its own type). */
  readonly shifts: ShiftCounts;
  /** Operational coverage per period (ME counts toward M and E). */
  readonly coverage: CoverageCounts;
  readonly findings: { readonly blocking: number; readonly other: number };
}

export interface ScheduleDaysSummary {
  readonly days: readonly ScheduleDaySummary[];
  /** Findings that belong to no day of the period (e.g. an assignment dated outside it). */
  readonly unattributedFindings: number;
}

/** Summarizes every day of the period from the assignments and their findings. */
export function summarizeScheduleDays(input: {
  readonly period: DatePeriod;
  readonly assignments: readonly Assignment[];
  readonly diagnostics: readonly Diagnostic[];
}): ScheduleDaysSummary {
  const { period } = input;
  const shiftsByDay = new Map<IsoDate, ShiftCode[]>();
  for (const a of input.assignments) {
    if (!isInPeriod(period, a.date)) continue;
    shiftsByDay.set(a.date, [...(shiftsByDay.get(a.date) ?? []), a.shift]);
  }
  const findingsByDay = new Map<IsoDate, Diagnostic[]>();
  let unattributedFindings = 0;
  for (const d of input.diagnostics) {
    if (d.date === null) unattributedFindings += 1;
    else findingsByDay.set(d.date, [...(findingsByDay.get(d.date) ?? []), d]);
  }

  const days = periodDays(period).map((date): ScheduleDaySummary => {
    const shifts = countByShift(shiftsByDay.get(date) ?? []);
    const findings = findingsByDay.get(date) ?? [];
    const blocking = findings.filter((f) => f.blocking).length;
    return {
      date,
      health: dayHealth({
        assignmentCount: shiftsByDay.get(date)?.length ?? 0,
        findingCount: findings.length,
      }),
      shifts,
      coverage: coverageOf(shifts),
      findings: { blocking, other: findings.length - blocking },
    };
  });
  return { days, unattributedFindings };
}
