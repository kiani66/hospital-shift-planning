import { uniqueSortedDates, type IsoDate } from "../shared/dates";
import { isInPeriod, type DatePeriod } from "../shared/period";
import type { ShiftCode } from "../shifts/shift-type";
import {
  isBlocking,
  violationFootprint,
  type Violation,
  type ViolationSeverity,
} from "./violation";

/** What a finding is about; decides where the review screens group it. */
export type DiagnosticScope = "DAY" | "SHIFT" | "NURSE" | "ASSIGNMENT";

/** Stable rule codes (`Violation["rule"]`); the UI translates them, never shows them raw. */
export type RuleCode = Violation["rule"];

/**
 * Scope of each rule. A new rule (e.g. a staffing validator, scope SHIFT)
 * adds a `Violation` variant and one entry here; the review screens pick it
 * up without other changes.
 */
export const RULE_SCOPES: Readonly<Record<RuleCode, DiagnosticScope>> = {
  // A nurse's own sequence of days: a Night followed by any shift.
  NIGHT_REST: "NURSE",
  DUPLICATE_ASSIGNMENT: "ASSIGNMENT",
  OUTSIDE_PERIOD: "ASSIGNMENT",
  // One coverage period of one day.
  STAFFING: "SHIFT",
};

/**
 * A rule violation as the review screens present it: the stable code,
 * scope, severity and blocking semantics, the day it is shown on and every
 * entity it involves. `violation` keeps the rule-specific data for the
 * human-readable message.
 */
export interface Diagnostic {
  readonly code: RuleCode;
  readonly scope: DiagnosticScope;
  readonly severity: ViolationSeverity;
  /** Blocks FINALIZE and SUBMIT (error severity). */
  readonly blocking: boolean;
  /** The day of the period it is reported on; null when none applies. */
  readonly date: IsoDate | null;
  /** Every day involved, sorted (a night-rest finding spans two). */
  readonly dates: readonly IsoDate[];
  readonly nurseIds: readonly string[];
  /** The assignment the finding is about, when there is one. */
  readonly shift: ShiftCode | null;
  readonly violation: Violation;
}

/**
 * The day of `period` a violation belongs to: the day of the offending
 * assignment. A night-rest pair across the schedule boundary (Night on the
 * last day, a shift on the next schedule's first day) belongs to the Night's
 * day, the one inside this period. An assignment dated outside the period
 * belongs to no day.
 */
export function violationDay(
  violation: Violation,
  period: DatePeriod,
): IsoDate | null {
  if (isInPeriod(period, violation.date)) return violation.date;
  if (
    violation.rule === "NIGHT_REST" &&
    isInPeriod(period, violation.nightDate)
  )
    return violation.nightDate;
  return null;
}

export function toDiagnostic(
  violation: Violation,
  period: DatePeriod,
): Diagnostic {
  const { nurseId, dates } = violationFootprint(violation);
  return {
    code: violation.rule,
    scope: RULE_SCOPES[violation.rule],
    severity: violation.severity,
    blocking: isBlocking(violation),
    date: violationDay(violation, period),
    dates: uniqueSortedDates(dates),
    // A staffing finding is about the period, not one nurse.
    nurseIds: nurseId === null ? [] : [nurseId],
    shift: violation.rule === "NIGHT_REST" ? violation.shift : null,
    violation,
  };
}
