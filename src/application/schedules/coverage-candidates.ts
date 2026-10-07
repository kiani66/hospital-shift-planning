import { z } from "zod";

import { decide } from "../../domain/authz/policies";
import {
  evaluateCandidates,
  isCandidateShift,
  type CandidateDayStatus,
  type CandidatePreference,
  type CandidateShift,
} from "../../domain/candidates/evaluate-candidates";
import { toDiagnostic } from "../../domain/rules/diagnostic";
import {
  bucketCoverage,
  type StaffingBounds,
  type StaffingStatus,
} from "../../domain/rules/staffing";
import {
  canEditAssignment,
  type AssignmentEditDenial,
} from "../../domain/schedule/assignment-editing";
import { addDays, isIsoDate, type IsoDate } from "../../domain/shared/dates";
import { ValidationError } from "../../domain/shared/errors";
import { isInPeriod } from "../../domain/shared/period";
import { unwrap } from "../../domain/shared/result";
import { countByShift, coverageOf } from "../../domain/shifts/coverage";
import {
  listAdjacentAssignments,
  listAssignments,
} from "../../infrastructure/repositories/assignments";
import { listPreferences } from "../../infrastructure/repositories/preferences";
import { findOpenRevision } from "../../infrastructure/repositories/revisions";
import { listRosterMembersOn } from "../../infrastructure/repositories/roster";
import { findScheduleById } from "../../infrastructure/repositories/schedules";
import { NO_HOLIDAY_DATA } from "../calendar/holidays";
import { NotFoundError } from "../errors";
import {
  holidayDates,
  loadRuleSet,
  requirementsUnder,
} from "../staffing-rules/pinned";
import type { AppContext } from "../use-case";
import type { ReviewFinding } from "./review";

/**
 * Candidate Recommendation V1 (D111), read side: who could fill a coverage
 * shortage of one day. Writes nothing (no revision, no assignment, no
 * schedule revision bump); assigning is a separate command.
 */

/** The target coverage period of the day against the pinned bounds (D106). */
export interface CandidateCoverage {
  readonly period: CandidateShift;
  /** Nurses staffing the period now (ME counts toward M and E, D42). */
  readonly covered: number;
  readonly bounds: StaffingBounds | null;
  readonly status: StaffingStatus;
  /** Missing nurses below the minimum; 0 otherwise. */
  readonly gap: number;
}

/** Who a candidate is, as the screens name people. */
export interface CandidateNurse {
  readonly userId: string;
  readonly displayName: string;
  readonly personnelNumber: string | null;
}

export interface AvailableCandidateView extends CandidateNurse {
  readonly dayStatus: CandidateDayStatus;
  readonly preference: CandidatePreference;
  readonly requiresOffReplacement: boolean;
}

export interface NotAllowedCandidateView extends CandidateNurse {
  readonly dayStatus: CandidateDayStatus;
  readonly preference: CandidatePreference;
  /** The blocking findings, in the review's form (the existing wording applies). */
  readonly findings: readonly ReviewFinding[];
}

interface CoverageCandidatesBase {
  readonly scheduleId: string;
  /** The schedule revision this list was read at (read before the data). */
  readonly revision: number;
  readonly date: IsoDate;
  readonly shift: CandidateShift;
  readonly coverage: CandidateCoverage;
}

export type CoverageCandidates =
  | (CoverageCandidatesBase & {
      /** The period is not below its minimum (none configured, or met): no list. */
      readonly status: "NO_SHORTAGE";
    })
  | (CoverageCandidatesBase & {
      readonly status: "SHORTAGE";
      /**
       * The actor may assign from the list now: `assignment.edit` for the
       * department and the cell editable (`canEditAssignment`: status,
       * period, revision scope). Informational; the command decides again.
       */
      readonly canAssign: boolean;
      /** Why not, when `canAssign` is false. */
      readonly assignDenial: AssignmentEditDenial | "NOT_AUTHORIZED" | null;
      /** In the domain's order: day status, preference, user id. */
      readonly available: readonly AvailableCandidateView[];
      /** In the domain's order: user id. */
      readonly notAllowed: readonly NotAllowedCandidateView[];
    });

export interface CoverageCandidatesInput {
  readonly scheduleId: string;
  readonly date: string;
  readonly shift: string;
}

/**
 * Authorized like the schedule review (`schedule.viewDepartment`: the
 * department's Head Nurse always, a Supervisor from FINALIZED on, D12); the
 * department is the schedule's own. A malformed, unknown or denied schedule
 * is NotFoundError (D26). The target must be a coverage period (M, E or N)
 * on a day of the period (ValidationError otherwise).
 *
 * Offered only for a real shortage (D111): the target period's current
 * coverage under the pinned version is BELOW_MINIMUM; otherwise the answer is
 * NO_SHORTAGE with the coverage and no list.
 *
 * The universe is the roster ∩ active accounts ∩ memberships of the
 * department in effect on the date, built in one query; each member is then
 * evaluated by the domain (`evaluateCandidates`) against the unchanged
 * working copy, with the neighbouring schedules' boundary days loaded for
 * the whole universe and the pinned bounds of the day.
 *
 * Queries, independent of roster size: the schedule; the working copy; the
 * pinned rule set (three); then for a shortage the universe, the day's
 * preferences, the boundary days and, in a revision-scoped status, the open
 * revision (two).
 */
export async function getCoverageCandidates(
  ctx: AppContext,
  input: CoverageCandidatesInput,
): Promise<CoverageCandidates> {
  const { db, actor } = ctx;
  const schedule = z.uuid().safeParse(input.scheduleId).success
    ? await findScheduleById(db, input.scheduleId)
    : null;
  if (
    !schedule ||
    !decide(actor, "schedule.viewDepartment", {
      departmentId: schedule.departmentId,
      status: schedule.status,
    }).allowed
  )
    throw new NotFoundError("Schedule");

  const { period } = schedule;
  const shift = input.shift;
  if (!isCandidateShift(shift))
    throw new ValidationError("The candidate shift must be M, E or N", "shift");
  const date = input.date;
  if (!isIsoDate(date) || !isInPeriod(period, date))
    throw new ValidationError("The date is not a day of the schedule", "date");

  const [assignments, ruleSet, holidays] = await Promise.all([
    listAssignments(db, schedule.id),
    loadRuleSet(db, schedule.staffingRuleSetVersionId),
    holidayDates(ctx.holidays ?? NO_HOLIDAY_DATA, period),
  ]);
  // The day's bounds only, as a change of that day is validated (D106).
  const requirements = requirementsUnder(ruleSet, [date], holidays);
  const bounds = requirements.get(date)?.[shift];
  const covered = coverageOf(
    countByShift(
      assignments.filter((a) => a.date === date).map((a) => a.shift),
    ),
  )[shift];
  const coverage: CandidateCoverage = {
    period: shift,
    ...bucketCoverage(covered, bounds),
    bounds: bounds ?? null,
  };
  const base = {
    scheduleId: schedule.id,
    revision: schedule.revision,
    date,
    shift,
    coverage,
  };
  if (coverage.status !== "BELOW_MINIMUM")
    return { ...base, status: "NO_SHORTAGE" };

  const mayEdit = decide(actor, "assignment.edit", {
    departmentId: schedule.departmentId,
  }).allowed;
  // The revision scope matters only once a schedule has been approved (D14).
  const revisionScoped =
    mayEdit &&
    (schedule.status === "REVISING" || schedule.status === "RETURNED");
  const [universe, preferences, revision] = await Promise.all([
    listRosterMembersOn(db, { scheduleId: schedule.id, onDate: date }),
    listPreferences(db, schedule.id, { date }),
    revisionScoped ? findOpenRevision(db, schedule.id) : null,
  ]);
  const nurseIds = universe.map((n) => n.userId);
  // Boundary days for the whole universe, not only for nurses who already
  // have shifts in this schedule: a nurse with no shift this month can still
  // follow a Night on the previous schedule's last day (D7, D20).
  const adjacent = await listAdjacentAssignments(db, {
    departmentId: schedule.departmentId,
    excludeScheduleId: schedule.id,
    nurseIds,
    dates: [addDays(period.start, -1), addDays(period.end, 1)],
  });

  const evaluation = unwrap(
    evaluateCandidates({
      period,
      date,
      shift,
      nurseIds,
      assignments,
      adjacentAssignments: adjacent,
      staffingRequirements: requirements,
      preferences: new Map(preferences.map((p) => [p.userId, p.value])),
    }),
  );

  const nurseOf = new Map(universe.map((n) => [n.userId, n]));
  const person = (userId: string): CandidateNurse => {
    const { displayName, personnelNumber } = nurseOf.get(userId)!;
    return { userId, displayName, personnelNumber };
  };
  const assign = mayEdit
    ? canEditAssignment({
        status: schedule.status,
        period,
        date,
        revisionDates: revision ? new Set(revision.dates) : null,
      })
    : ({ allowed: false, reason: "NOT_AUTHORIZED" } as const);

  return {
    ...base,
    status: "SHORTAGE",
    canAssign: assign.allowed,
    assignDenial: assign.allowed ? null : assign.reason,
    available: evaluation.available.map((c) => ({
      ...person(c.nurseId),
      dayStatus: c.dayStatus,
      preference: c.preference,
      requiresOffReplacement: c.requiresOffReplacement,
    })),
    notAllowed: evaluation.notAllowed.map((c) => ({
      ...person(c.nurseId),
      dayStatus: c.dayStatus,
      preference: c.preference,
      findings: c.blocking.map((v) => {
        const diagnostic = toDiagnostic(v, period);
        return {
          ...diagnostic,
          // A candidate's own findings name only them (a staffing one nobody).
          nurses: diagnostic.nurseIds.map((id) => ({
            userId: id,
            displayName: nurseOf.get(id)?.displayName ?? "—",
          })),
        };
      }),
    })),
  };
}
