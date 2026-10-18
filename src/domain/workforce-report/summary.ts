import type { MembershipRole } from "../authz/actor";
import type { IsoDate } from "../shared/dates";
import { ValidationError } from "../shared/errors";
import {
  createPeriod,
  isInPeriod,
  periodDays,
  type DatePeriod,
} from "../shared/period";
import { err, ok, type Result } from "../shared/result";
import type { Assignment } from "../shifts/assignment";
import type { AssignmentCode } from "../shifts/shift-type";
import { summarizeShifts } from "../shifts/working-time";

/** Minimum identity from the schedule roster, never current membership eligibility. */
export interface WorkforceRosterMember {
  readonly userId: string;
  readonly role: MembershipRole;
}

export type WorkforceDecisionCounts = Readonly<
  Record<AssignmentCode | "UNDECIDED", number>
>;

/** An absent recorded decision is null, never an inferred OFF. */
export interface WorkforceDay {
  readonly date: IsoDate;
  readonly decision: AssignmentCode | null;
}

export interface WorkforcePersonSummary extends WorkforceRosterMember {
  readonly counts: WorkforceDecisionCounts;
  readonly workingShiftCount: number;
  readonly scheduledMinutes: number;
  readonly reportingDayCount: number;
  readonly isComplete: boolean;
  /** Every period day, chronologically, reusable by read-only detail presentation. */
  readonly days: readonly WorkforceDay[];
}

export interface WorkforceSummary {
  readonly period: DatePeriod;
  readonly reportingDayCount: number;
  /** Deterministic user-id order; presentation sorting belongs to the adapter. */
  readonly rows: readonly WorkforcePersonSummary[];
  /** All roster-days have decisions; true for an empty roster. Not workflow approval. */
  readonly isComplete: boolean;
}

/**
 * Recorded workload for exactly one schedule's actual inclusive ISO period.
 * Callers select working or approved assignments before calling this pure function.
 * Every roster member has the full denominator regardless of role, account activity
 * or membership dates. Nights count whole on their assignment date (D98).
 *
 * Invalid periods, duplicate roster identities, duplicate nurse-days (even identical
 * decisions), non-roster assignments and out-of-period assignments return VALIDATION.
 * These violate the existing schedule contracts (D15, D21), so they are never silently
 * dropped or counted twice. Inputs are not mutated; no scheduling rule is changed.
 */
export function summarizeWorkforce(input: {
  readonly period: DatePeriod;
  readonly roster: readonly WorkforceRosterMember[];
  readonly assignments: readonly Assignment[];
}): Result<WorkforceSummary, ValidationError> {
  const period = createPeriod(input.period.start, input.period.end);
  if (!period.ok) return period;
  const dates = periodDays(period.value);
  const byPerson = new Map<string, Map<IsoDate, AssignmentCode>>();
  for (const member of input.roster) {
    if (byPerson.has(member.userId))
      return err(new ValidationError("Duplicate roster member", "roster"));
    byPerson.set(member.userId, new Map());
  }
  for (const assignment of input.assignments) {
    const decisions = byPerson.get(assignment.nurseId);
    if (!decisions)
      return err(
        new ValidationError(
          "The nurse is not on the schedule roster",
          "nurseId",
        ),
      );
    if (!isInPeriod(period.value, assignment.date))
      return err(
        new ValidationError("The date is outside the schedule period", "date"),
      );
    if (decisions.has(assignment.date))
      return err(
        new ValidationError(
          "The same nurse and day appear more than once",
          "assignments",
        ),
      );
    decisions.set(assignment.date, assignment.shift);
  }

  const rows = [...input.roster]
    .sort((a, b) => (a.userId < b.userId ? -1 : 1))
    .map((member): WorkforcePersonSummary => {
      const decisions = byPerson.get(member.userId)!;
      const days = dates.map((date): WorkforceDay => ({
        date,
        decision: decisions.get(date) ?? null,
      }));
      const totals = summarizeShifts(days.map((day) => day.decision));
      const undecided = dates.length - decisions.size;
      return {
        userId: member.userId,
        role: member.role,
        counts: {
          ...totals.byCode,
          OFF: totals.offCount,
          H: totals.leaveCount,
          UNDECIDED: undecided,
        },
        workingShiftCount: totals.shiftCount,
        scheduledMinutes: totals.minutes,
        reportingDayCount: dates.length,
        isComplete: undecided === 0,
        days,
      };
    });
  return ok({
    period: period.value,
    reportingDayCount: dates.length,
    rows,
    isComplete: rows.every((row) => row.isComplete),
  });
}
