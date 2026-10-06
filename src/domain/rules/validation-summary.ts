import { uniqueSortedDates, type IsoDate } from "../shared/dates";
import { isInPeriod, periodDays, type DatePeriod } from "../shared/period";
import type { Assignment } from "../shifts/assignment";
import { COVERAGE_PERIODS, type BaseShift } from "../shifts/shift-type";
import { violationDay } from "./diagnostic";
import type { StaffingBounds } from "./staffing";
import { violationKey, violationMagnitude, type Violation } from "./violation";

/**
 * The three validation categories (D102), kept apart everywhere: an
 * undecided nurse-day is not a conflict, a coverage problem is about a
 * bucket, and only hard scheduling rules are "rule violations". All three
 * block FINALIZE and SUBMIT; none blocks saving a draft.
 */
export type ValidationCategory = "UNDECIDED" | "COVERAGE" | "RULE_VIOLATION";

export function validationCategory(violation: Violation): ValidationCategory {
  switch (violation.rule) {
    case "UNDECIDED":
      return "UNDECIDED";
    case "STAFFING":
      return "COVERAGE";
    case "NIGHT_REST":
    case "DUPLICATE_ASSIGNMENT":
    case "OUTSIDE_PERIOD":
      return "RULE_VIOLATION";
  }
}

/** A coverage problem is a shortage (below min) or overstaffing (above max). */
export type CoverageKind = "SHORTAGE" | "OVERSTAFFING";

/** One affected bucket (day × M/E/N), counted once whatever the amount. */
export interface CoverageProblem {
  readonly date: IsoDate;
  readonly period: BaseShift;
  readonly kind: CoverageKind;
  readonly covered: number;
  readonly bounds: StaffingBounds;
  /** Missing or excess nurses. */
  readonly amount: number;
}

type StaffingViolation = Extract<Violation, { rule: "STAFFING" }>;

export const coverageProblem = (v: StaffingViolation): CoverageProblem => ({
  date: v.date,
  period: v.period,
  kind: v.status === "BELOW_MINIMUM" ? "SHORTAGE" : "OVERSTAFFING",
  covered: v.covered,
  bounds: v.bounds,
  amount: violationMagnitude(v),
});

const isStaffing = (v: Violation): v is StaffingViolation =>
  v.rule === "STAFFING";

const bucketOrder = (p: BaseShift) => COVERAGE_PERIODS.indexOf(p);

/** Every coverage problem of `violations`, by date then bucket. */
export const coverageProblems = (
  violations: readonly Violation[],
): CoverageProblem[] =>
  violations
    .filter(isStaffing)
    .map(coverageProblem)
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        bucketOrder(a.period) - bucketOrder(b.period),
    );

/**
 * A day's primary visual state (D103). Severity: RULE_VIOLATION > COVERAGE
 * > UNDECIDED > READY. A day without any explicit decision is NOT_STARTED
 * (presentation only: its counts still block FINALIZE).
 */
export type DayState =
  "NOT_STARTED" | "RULE_VIOLATION" | "COVERAGE" | "UNDECIDED" | "READY";

export const DAY_STATES = [
  "NOT_STARTED",
  "RULE_VIOLATION",
  "COVERAGE",
  "UNDECIDED",
  "READY",
] as const satisfies readonly DayState[];

/** Every category's count for one day, all visible at once. */
export interface DayValidation {
  readonly date: IsoDate;
  /** Explicit decisions (rows, OFF included) on the day. */
  readonly decisions: number;
  /** Undecided nurse-days. */
  readonly undecided: number;
  readonly shortages: number;
  readonly overstaffing: number;
  readonly ruleViolations: number;
  readonly state: DayState;
  /** No undecided decision, no coverage problem and no rule violation. */
  readonly ready: boolean;
}

/** The month's counts per category. */
export interface ValidationCounts {
  /** Undecided nurse-days (the primary unit). */
  readonly undecided: number;
  /** Distinct days with at least one undecided nurse-day. */
  readonly undecidedDays: number;
  /** Affected buckets (shortages + overstaffing). */
  readonly coverageProblems: number;
  readonly shortages: number;
  readonly overstaffing: number;
  /** Missing nurses over all shortages. */
  readonly shortBy: number;
  /** Excess nurses over all overstaffed buckets. */
  readonly excessBy: number;
  /** Including findings that belong to no day of the period. */
  readonly ruleViolations: number;
  readonly readyDays: number;
  readonly totalDays: number;
}

export interface ValidationSummary extends ValidationCounts {
  readonly days: readonly DayValidation[];
  /** Rule violations not attributable to a day (an assignment outside the period). */
  readonly unattributedRuleViolations: number;
  /** Every category is clean: FINALIZE / SUBMIT would not be refused for validation. */
  readonly ready: boolean;
}

function dayState(day: Omit<DayValidation, "state">): DayState {
  if (day.ready) return "READY";
  if (day.decisions === 0) return "NOT_STARTED";
  if (day.ruleViolations > 0) return "RULE_VIOLATION";
  if (day.shortages + day.overstaffing > 0) return "COVERAGE";
  return "UNDECIDED";
}

/**
 * Summarizes a working copy's findings per category, per day and for the
 * month. Findings belong to the day `violationDay` attributes them to (a
 * night-rest finding to the day after the Night, D43), so a change on one day
 * shows on the dependent one.
 */
export function summarizeValidation(input: {
  readonly period: DatePeriod;
  readonly assignments: readonly Assignment[];
  readonly violations: readonly Violation[];
}): ValidationSummary {
  const { period } = input;
  const decisions = new Map<IsoDate, number>();
  for (const a of input.assignments)
    if (isInPeriod(period, a.date))
      decisions.set(a.date, (decisions.get(a.date) ?? 0) + 1);

  type Tally = {
    undecided: number;
    shortages: number;
    overstaffing: number;
    ruleViolations: number;
  };
  const tallies = new Map<IsoDate, Tally>();
  const tally = (date: IsoDate) => {
    let t = tallies.get(date);
    if (!t) {
      t = { undecided: 0, shortages: 0, overstaffing: 0, ruleViolations: 0 };
      tallies.set(date, t);
    }
    return t;
  };
  let unattributed = 0;
  let shortBy = 0;
  let excessBy = 0;
  for (const v of input.violations) {
    const date = violationDay(v, period);
    if (date === null) {
      unattributed += 1;
      continue;
    }
    const t = tally(date);
    switch (validationCategory(v)) {
      case "UNDECIDED":
        t.undecided += 1;
        break;
      case "COVERAGE": {
        const problem = coverageProblem(v as StaffingViolation);
        if (problem.kind === "SHORTAGE") {
          t.shortages += 1;
          shortBy += problem.amount;
        } else {
          t.overstaffing += 1;
          excessBy += problem.amount;
        }
        break;
      }
      case "RULE_VIOLATION":
        t.ruleViolations += 1;
    }
  }

  const days = periodDays(period).map((date): DayValidation => {
    const t = tallies.get(date) ?? {
      undecided: 0,
      shortages: 0,
      overstaffing: 0,
      ruleViolations: 0,
    };
    const base = {
      date,
      decisions: decisions.get(date) ?? 0,
      ...t,
      ready:
        t.undecided === 0 &&
        t.shortages === 0 &&
        t.overstaffing === 0 &&
        t.ruleViolations === 0,
    };
    return { ...base, state: dayState(base) };
  });

  const sum = (key: keyof Tally) => days.reduce((n, d) => n + d[key], 0);
  const counts: ValidationCounts = {
    undecided: sum("undecided"),
    undecidedDays: days.filter((d) => d.undecided > 0).length,
    coverageProblems: sum("shortages") + sum("overstaffing"),
    shortages: sum("shortages"),
    overstaffing: sum("overstaffing"),
    shortBy,
    excessBy,
    ruleViolations: sum("ruleViolations") + unattributed,
    readyDays: days.filter((d) => d.ready).length,
    totalDays: days.length,
  };
  return {
    ...counts,
    days,
    unattributedRuleViolations: unattributed,
    ready:
      counts.undecided === 0 &&
      counts.coverageProblems === 0 &&
      counts.ruleViolations === 0,
  };
}

/** Only the month's counts (what an audit event keeps). */
export const validationCounts = (
  summary: ValidationSummary,
): ValidationCounts => ({
  undecided: summary.undecided,
  undecidedDays: summary.undecidedDays,
  coverageProblems: summary.coverageProblems,
  shortages: summary.shortages,
  overstaffing: summary.overstaffing,
  shortBy: summary.shortBy,
  excessBy: summary.excessBy,
  ruleViolations: summary.ruleViolations,
  readyDays: summary.readyDays,
  totalDays: summary.totalDays,
});

/** What validating the same assignments under other rules would change (D107). */
export interface ValidationImpact {
  readonly before: ValidationCounts;
  readonly after: ValidationCounts;
  /** READY days that would no longer be ready. */
  readonly becameNotReady: readonly IsoDate[];
  /** Days that would become ready. */
  readonly becameReady: readonly IsoDate[];
  /** Coverage problems that are new or worse afterwards (the days to repair). */
  readonly introduced: readonly CoverageProblem[];
  /** Coverage problems that would disappear. */
  readonly resolved: readonly CoverageProblem[];
  /** Every coverage problem afterwards. */
  readonly coverageAfter: readonly CoverageProblem[];
  /** The days of `introduced`, sorted (what a revision's scope must include). */
  readonly datesToRepair: readonly IsoDate[];
}

/**
 * Compares the findings of one working copy before and after a change of
 * rules (the assignments are the same). "New or worse" follows the change
 * assessment (D69): the same `violationKey` with a larger magnitude is worse.
 */
export function compareValidation(input: {
  readonly period: DatePeriod;
  readonly assignments: readonly Assignment[];
  readonly before: readonly Violation[];
  readonly after: readonly Violation[];
}): ValidationImpact {
  const before = summarizeValidation({ ...input, violations: input.before });
  const after = summarizeValidation({ ...input, violations: input.after });
  const magnitudes = (violations: readonly Violation[]) =>
    new Map(
      violations
        .filter(isStaffing)
        .map((v) => [violationKey(v), violationMagnitude(v)]),
    );
  const previous = magnitudes(input.before);
  const next = magnitudes(input.after);
  const introduced = coverageProblems(
    input.after.filter((v) => {
      const was = previous.get(violationKey(v));
      return was === undefined || violationMagnitude(v) > was;
    }),
  );
  const resolved = coverageProblems(
    input.before.filter((v) => !next.has(violationKey(v))),
  );
  const readyDates = (summary: ValidationSummary) =>
    new Set(summary.days.filter((d) => d.ready).map((d) => d.date));
  const readyBefore = readyDates(before);
  const readyAfter = readyDates(after);
  return {
    before: validationCounts(before),
    after: validationCounts(after),
    becameNotReady: [...readyBefore].filter((d) => !readyAfter.has(d)),
    becameReady: [...readyAfter].filter((d) => !readyBefore.has(d)),
    introduced,
    resolved,
    coverageAfter: coverageProblems(input.after),
    datesToRepair: uniqueSortedDates(introduced.map((p) => p.date)),
  };
}
