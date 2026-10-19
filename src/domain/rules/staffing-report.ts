import type { IsoDate } from "../shared/dates";
import { createPeriod, periodDays, type DatePeriod } from "../shared/period";
import type { Assignment } from "../shifts/assignment";
import { countByShift, coverageOf } from "../shifts/coverage";
import { COVERAGE_PERIODS, type BaseShift } from "../shifts/shift-type";
import { bucketCoverage, type StaffingBounds, type StaffingRequirement, type StaffingStatus } from "./staffing";

/** Resolved by the caller using the selected schedule version's pinned rule set. */
export type RequirementOrigin = "DATE_EXCEPTION" | "HOLIDAY" | "NORMAL";

export interface StaffingReportBucket {
  readonly period: BaseShift;
  readonly bounds: StaffingBounds | undefined;
  readonly covered: number;
  readonly status: StaffingStatus;
  readonly shortage: number;
  readonly excess: number;
  readonly origin: RequirementOrigin | undefined;
}

export interface StaffingReportDay {
  readonly date: IsoDate;
  readonly buckets: readonly StaffingReportBucket[];
  /** Missing nurse-day decisions, not whole-roster incompleteness. */
  readonly undecidedNurses: number;
}

export interface StaffingReportTotals {
  readonly affectedShortageDays: number;
  readonly shortageBuckets: number;
  /** Sum of nurse-period deficits, NOT distinct missing people or hires. */
  readonly shortageAmount: number;
  readonly affectedExcessDays: number;
  readonly excessBuckets: number;
  readonly excessAmount: number;
  readonly undecidedNurseDays: number;
}

export interface StaffingReport {
  readonly days: readonly StaffingReportDay[];
  readonly totals: StaffingReportTotals;
  readonly byPeriod: Readonly<Record<BaseShift, Omit<StaffingReportTotals, "affectedShortageDays" | "affectedExcessDays" | "undecidedNurseDays">>>;
}

/**
 * Compose a read-only planned nursing-coverage report.
 *
 * The application layer MUST supply a coherent, authorized source snapshot:
 * assignments, historical nursing roster and requirements resolved from the
 * selected source's pinned rules. Never feed working assignments into an
 * approved report, or current membership in place of the roster snapshot.
 */
export function composeStaffingReport(input: {
  readonly period: DatePeriod;
  readonly nursingRosterIds: readonly string[];
  readonly assignments: readonly Assignment[];
  readonly requirements: ReadonlyMap<IsoDate, StaffingRequirement>;
  readonly origins?: ReadonlyMap<IsoDate, Partial<Record<BaseShift, RequirementOrigin>>>;
}): StaffingReport {
  const valid = createPeriod(input.period.start, input.period.end);
  if (!valid.ok) throw valid.error;
  const dates = periodDays(valid.value);
  const daysSet = new Set(dates);
  const roster = new Set(input.nursingRosterIds);
  if (roster.size !== input.nursingRosterIds.length || input.nursingRosterIds.some((id) => !id))
    throw new RangeError("Invalid nursing roster");

  const decisions = new Map<IsoDate, Map<string, Assignment["shift"]>>();
  for (const assignment of input.assignments) {
    if (!daysSet.has(assignment.date) || !roster.has(assignment.nurseId)) continue;
    const day = decisions.get(assignment.date) ?? new Map<string, Assignment["shift"]>();
    if (day.has(assignment.nurseId)) throw new RangeError("Duplicate nurse-day assignment");
    day.set(assignment.nurseId, assignment.shift);
    decisions.set(assignment.date, day);
  }

  const zeroPeriod = () => ({ shortageBuckets: 0, shortageAmount: 0, excessBuckets: 0, excessAmount: 0 });
  const byPeriod = { M: zeroPeriod(), E: zeroPeriod(), N: zeroPeriod() };
  let affectedShortageDays = 0;
  let affectedExcessDays = 0;
  let undecidedNurseDays = 0;

  const days: StaffingReportDay[] = dates.map((date) => {
    const decisionsForDay = decisions.get(date);
    const shifts = [...(decisionsForDay?.values() ?? [])];
    const coverage = coverageOf(countByShift(shifts));
    const undecidedNurses = roster.size - (decisionsForDay?.size ?? 0);
    undecidedNurseDays += undecidedNurses;
    let hasShortage = false;
    let hasExcess = false;
    const buckets = COVERAGE_PERIODS.map((period): StaffingReportBucket => {
      const bounds = input.requirements.get(date)?.[period];
      const comparison = bucketCoverage(coverage[period], bounds);
      const shortage = comparison.status === "BELOW_MINIMUM" ? comparison.gap : 0;
      const excess = comparison.status === "ABOVE_MAXIMUM" ? comparison.gap : 0;
      if (shortage) {
        hasShortage = true;
        byPeriod[period].shortageBuckets++;
        byPeriod[period].shortageAmount += shortage;
      }
      if (excess) {
        hasExcess = true;
        byPeriod[period].excessBuckets++;
        byPeriod[period].excessAmount += excess;
      }
      return { period, bounds, covered: coverage[period], status: comparison.status, shortage, excess, origin: input.origins?.get(date)?.[period] };
    });
    if (hasShortage) affectedShortageDays++;
    if (hasExcess) affectedExcessDays++;
    return { date, buckets, undecidedNurses };
  });

  return {
    days,
    totals: {
      affectedShortageDays,
      shortageBuckets: COVERAGE_PERIODS.reduce((sum, p) => sum + byPeriod[p].shortageBuckets, 0),
      shortageAmount: COVERAGE_PERIODS.reduce((sum, p) => sum + byPeriod[p].shortageAmount, 0),
      affectedExcessDays,
      excessBuckets: COVERAGE_PERIODS.reduce((sum, p) => sum + byPeriod[p].excessBuckets, 0),
      excessAmount: COVERAGE_PERIODS.reduce((sum, p) => sum + byPeriod[p].excessAmount, 0),
      undecidedNurseDays,
    },
    byPeriod,
  };
}
