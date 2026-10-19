import type { MembershipRole } from "../authz/actor";
import { bucketCoverage } from "../rules/staffing";
import { isIsoDate, type IsoDate } from "../shared/dates";
import { ValidationError } from "../shared/errors";
import {
  createPeriod,
  isInPeriod,
  periodDays,
  type DatePeriod,
} from "../shared/period";
import { err, ok, type Result } from "../shared/result";
import type { Assignment } from "../shifts/assignment";
import { countByShift, coverageOf } from "../shifts/coverage";
import {
  COVERAGE_PERIODS,
  isAssignmentCode,
  type AssignmentCode,
  type BaseShift,
} from "../shifts/shift-type";
import {
  validateRuleSetContent,
  type RuleSetContent,
} from "../staffing-rules/model";
import {
  resolveDay,
  toStaffingBounds,
  type RequirementSource,
} from "../staffing-rules/resolve";

/** Historical schedule identity and snapshot role; no current eligibility filter. */
export interface StaffingRosterMember {
  readonly userId: string;
  readonly role: MembershipRole;
}

export interface StaffingReportInput {
  readonly period: DatePeriod;
  readonly roster: readonly StaffingRosterMember[];
  /** One already-selected schedule source, never combined with another source. */
  readonly assignments: readonly Assignment[];
  /** The caller supplies the selected source's pinned version content. */
  readonly ruleSet: RuleSetContent;
  /** Only supplied official dates activate HOLIDAY bounds; Fridays are not inferred. */
  readonly officialHolidays: ReadonlySet<IsoDate>;
}

export type StaffingReportStatus = "SHORTAGE" | "EXCESS" | "WITHIN_BOUNDS";

/** One date × coverage period, including zero coverage and within-bounds rows. */
export interface StaffingBucketRecord {
  readonly date: IsoDate;
  readonly period: BaseShift;
  readonly covered: number;
  readonly min: number;
  /** null means unlimited, matching the pinned rule-set content. */
  readonly max: number | null;
  readonly status: StaffingReportStatus;
  /** Missing or excess people in this period; zero within bounds. */
  readonly gap: number;
  readonly source: RequirementSource;
}

export interface StaffingReportTotals {
  readonly totalBuckets: number;
  readonly shortageBuckets: number;
  readonly shortageDays: number;
  /** Sum of shortage gaps in person-periods, never unique people or shifts. */
  readonly shortagePersonPeriods: number;
  readonly excessBuckets: number;
  readonly excessDays: number;
  /** Sum of excess gaps in person-periods; never offsets shortage. */
  readonly excessPersonPeriods: number;
  readonly withinBoundsBuckets: number;
}

export interface StaffingSummary {
  readonly period: DatePeriod;
  readonly reportingDayCount: number;
  /** Chronological dates, then M, E, N: exactly three rows per date. */
  readonly rows: readonly StaffingBucketRecord[];
  readonly totals: StaffingReportTotals;
  /** Missing nursing roster-days only; OFF/H are explicit decisions, not missing. */
  readonly undecidedNurseDays: number;
}

/**
 * Recorded nursing coverage for one schedule's actual inclusive ISO period.
 * NURSE and HEAD_NURSE count; SECRETARY never counts. Activity and membership
 * dates do not discard history. Source selection belongs to the caller.
 *
 * Reuses pinned Exception > Holiday > Normal resolution and the existing
 * staffing comparison. Staffing compliance alone never determines schedule
 * readiness: no night-rest, lifecycle or overall validation result is inferred.
 * Inputs are not mutated. Invalid records return ValidationError rather than
 * being silently dropped, treated as OFF, or counted twice.
 */
export function summarizeStaffing(
  input: StaffingReportInput,
): Result<StaffingSummary, ValidationError> {
  const period = createPeriod(input.period.start, input.period.end);
  if (!period.ok) return period;
  const rules = validateRuleSetContent(input.ruleSet);
  if (!rules.ok) return rules;
  for (const exception of rules.value.exceptions)
    if (!COVERAGE_PERIODS.includes(exception.period))
      return err(new ValidationError("Invalid coverage period", "exceptions"));
  for (const date of input.officialHolidays)
    if (!isIsoDate(date))
      return err(
        new ValidationError(
          "Invalid official holiday date",
          "officialHolidays",
        ),
      );

  const roster = new Map<string, MembershipRole>();
  let nursingRosterCount = 0;
  for (const member of input.roster) {
    if (
      typeof member.userId !== "string" ||
      member.userId.trim().length === 0 ||
      (member.role !== "NURSE" &&
        member.role !== "HEAD_NURSE" &&
        member.role !== "SECRETARY")
    )
      return err(new ValidationError("Invalid roster member", "roster"));
    if (roster.has(member.userId))
      return err(new ValidationError("Duplicate roster member", "roster"));
    roster.set(member.userId, member.role);
    if (member.role !== "SECRETARY") nursingRosterCount += 1;
  }

  const seen = new Map<string, Set<IsoDate>>();
  const nursingDecisions = new Map<IsoDate, AssignmentCode[]>();
  let nursingDecisionCount = 0;
  for (const assignment of input.assignments) {
    const role = roster.get(assignment.nurseId);
    if (role === undefined)
      return err(
        new ValidationError(
          "The nurse is not on the schedule roster",
          "nurseId",
        ),
      );
    if (
      !isIsoDate(assignment.date) ||
      !isInPeriod(period.value, assignment.date)
    )
      return err(
        new ValidationError(
          "The date is invalid or outside the schedule period",
          "date",
        ),
      );
    if (!isAssignmentCode(assignment.shift))
      return err(new ValidationError("Invalid assignment code", "shift"));
    const dates = seen.get(assignment.nurseId) ?? new Set<IsoDate>();
    if (dates.has(assignment.date))
      return err(
        new ValidationError(
          "The same nurse and day appear more than once",
          "assignments",
        ),
      );
    dates.add(assignment.date);
    seen.set(assignment.nurseId, dates);
    if (role !== "SECRETARY") {
      const codes = nursingDecisions.get(assignment.date) ?? [];
      codes.push(assignment.shift);
      nursingDecisions.set(assignment.date, codes);
      nursingDecisionCount += 1;
    }
  }

  const dates = periodDays(period.value);
  const shortageDays = new Set<IsoDate>();
  const excessDays = new Set<IsoDate>();
  let shortageBuckets = 0;
  let excessBuckets = 0;
  let shortagePersonPeriods = 0;
  let excessPersonPeriods = 0;
  const rows = dates.flatMap((date) => {
    const coverage = coverageOf(countByShift(nursingDecisions.get(date) ?? []));
    const resolved = resolveDay(
      rules.value,
      date,
      input.officialHolidays.has(date),
    );
    return COVERAGE_PERIODS.map((p): StaffingBucketRecord => {
      const bounds = resolved[p];
      const comparison = bucketCoverage(coverage[p], toStaffingBounds(bounds));
      const status: StaffingReportStatus =
        comparison.status === "BELOW_MINIMUM"
          ? "SHORTAGE"
          : comparison.status === "ABOVE_MAXIMUM"
            ? "EXCESS"
            : "WITHIN_BOUNDS";
      if (status === "SHORTAGE") {
        shortageBuckets += 1;
        shortageDays.add(date);
        shortagePersonPeriods += comparison.gap;
      } else if (status === "EXCESS") {
        excessBuckets += 1;
        excessDays.add(date);
        excessPersonPeriods += comparison.gap;
      }
      return {
        date,
        period: p,
        covered: comparison.covered,
        min: bounds.min,
        max: bounds.max,
        status,
        gap: comparison.gap,
        source: bounds.source,
      };
    });
  });
  return ok({
    period: period.value,
    reportingDayCount: dates.length,
    rows,
    totals: {
      totalBuckets: rows.length,
      shortageBuckets,
      shortageDays: shortageDays.size,
      shortagePersonPeriods,
      excessBuckets,
      excessDays: excessDays.size,
      excessPersonPeriods,
      withinBoundsBuckets: rows.length - shortageBuckets - excessBuckets,
    },
    undecidedNurseDays:
      dates.length * nursingRosterCount - nursingDecisionCount,
  });
}
