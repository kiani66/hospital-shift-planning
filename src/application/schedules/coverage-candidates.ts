import { z } from "zod";

import { decide } from "../../domain/authz/policies";
import {
  candidateDayStatus,
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
  type StaffingRequirement,
  type StaffingStatus,
} from "../../domain/rules/staffing";
import { assessEdits } from "../../domain/schedule/assess-edits";
import {
  ASSIGNMENT_EDIT_REFUSALS,
  canEditAssignment,
  type AssignmentChange,
  type AssignmentEditDenial,
} from "../../domain/schedule/assignment-editing";
import { addDays, isIsoDate, type IsoDate } from "../../domain/shared/dates";
import {
  InvalidStateError,
  RuleViolationError,
  ValidationError,
} from "../../domain/shared/errors";
import { isInPeriod } from "../../domain/shared/period";
import { unwrap } from "../../domain/shared/result";
import type { Assignment } from "../../domain/shifts/assignment";
import { countByShift, coverageOf } from "../../domain/shifts/coverage";
import { COVERAGE_PERIODS } from "../../domain/shifts/shift-type";
import {
  listAdjacentAssignments,
  listAssignments,
} from "../../infrastructure/repositories/assignments";
import { lockActiveSchedulingUsers } from "../../infrastructure/repositories/management";
import { listPreferences } from "../../infrastructure/repositories/preferences";
import { findOpenRevision } from "../../infrastructure/repositories/revisions";
import {
  listRosterMembersOn,
  lockRosterMemberOn,
} from "../../infrastructure/repositories/roster";
import { findScheduleById } from "../../infrastructure/repositories/schedules";
import { NO_HOLIDAY_DATA } from "../calendar/holidays";
import { ConflictError, NotFoundError } from "../errors";
import {
  holidayDates,
  loadRuleSet,
  requirementsUnder,
} from "../staffing-rules/pinned";
import { defineCommand, type AppContext } from "../use-case";
import { writeAssignmentChanges } from "./edit-assignments";
import {
  loadScheduleForAssignmentUpdate,
  saveSchedule,
} from "./load-for-update";
import type { ReviewFinding } from "./review";

/**
 * Candidate Recommendation V1 (D111): who could fill a coverage shortage of
 * one day (`getCoverageCandidates`, read only), and assigning one of them
 * (`assignCoverageCandidate`, a stricter command than the planning editor).
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

/**
 * The target period's coverage on `date` from the working copy and the
 * pinned bounds: the existing staffing comparison (`bucketCoverage`), ME
 * counting toward M and E (D42). The one gate of the feature, read and write.
 */
function targetCoverage(
  assignments: readonly Assignment[],
  requirements: ReadonlyMap<IsoDate, StaffingRequirement>,
  date: IsoDate,
  shift: CandidateShift,
): CandidateCoverage {
  const bounds = requirements.get(date)?.[shift];
  const covered = coverageOf(
    countByShift(
      assignments.filter((a) => a.date === date).map((a) => a.shift),
    ),
  )[shift];
  return {
    period: shift,
    ...bucketCoverage(covered, bounds),
    bounds: bounds ?? null,
  };
}

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
  const coverage = targetCoverage(assignments, requirements, date, shift);
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

/**
 * `ConflictError.reason` when a candidate assignment's own preconditions no
 * longer hold: the recommendation is out of date and must be re-read. These
 * are preconditions of this use case, not scheduling rules (D111).
 */
export const CANDIDATE_ASSIGNMENT_REFUSALS = {
  /** Not on the roster, inactive, or no membership of the department that day. */
  NOT_A_CANDIDATE: "NOT_A_CANDIDATE",
  /** Already works that day (M, E, N or ME): V1 never replaces a working shift. */
  ALREADY_WORKING: "CANDIDATE_ALREADY_WORKING",
  /** The target period is not below its minimum (any more). */
  NO_SHORTAGE: "NO_SHORTAGE",
} as const;

export const assignCoverageCandidateInput = z.object({
  scheduleId: z.uuid(),
  /** The `revision` the candidate list was read at (D49). */
  expectedRevision: z.number().int().nonnegative(),
  date: z
    .string()
    .refine(isIsoDate, "Expected a YYYY-MM-DD date")
    .transform((value) => value as IsoDate),
  /** The short coverage period's own code; never ME or OFF. */
  shift: z.enum(COVERAGE_PERIODS),
  nurseId: z.uuid(),
});

export interface AssignCoverageCandidateOutput {
  readonly scheduleId: string;
  /** The schedule revision after the assignment; re-read the list with it. */
  readonly revision: number;
  /** The written cell: before is null (undecided) or OFF (replaced). */
  readonly change: AssignmentChange;
}

const refuse = (reason: string) =>
  new ConflictError(
    "The recommendation is out of date; reload the candidates",
    reason,
  );

/**
 * Assigns a recommended nurse to a coverage shortage (D111). Stricter than
 * the planning editor, whose behaviour is unchanged: in one transaction,
 *
 * 1. lock the schedule row and authorize `assignment.edit` for its own
 *    department (Head Nurse only; a Supervisor previews but never assigns);
 * 2. the cell must be editable now (`canEditAssignment`: status, period,
 *    revision scope; nothing starts or extends a revision or withdraws);
 * 3. the caller's revision must be current (a stale list is CONFLICT);
 * 4. the nurse must still be in the universe: active account (share-locked
 *    as every new scheduling write, D80), on the roster and a member of the
 *    department on the date;
 * 5. their day must still be undecided or OFF (OFF is replaced in place);
 * 6. the target period must still be BELOW_MINIMUM under the pinned rules;
 * 7. the shared hard-rule assessment (`assessEdits`, with the nurse's
 *    neighbouring-schedule boundary days) must not block it
 *    (RULE_VIOLATION with the findings);
 * 8. write and audit the cell exactly as the editor does and bump the
 *    revision.
 *
 * Any refusal rolls everything back: nothing is written, audited or bumped.
 * Preferences and ranking are advice and are not checked again.
 */
export const assignCoverageCandidate = defineCommand({
  name: "coverageCandidate.assign",
  input: assignCoverageCandidateInput,
  async handler(uow, input): Promise<AssignCoverageCandidateOutput> {
    const schedule = await loadScheduleForAssignmentUpdate(
      uow,
      input.scheduleId,
    );
    uow.authorize("assignment.edit", { departmentId: schedule.departmentId });
    const { period } = schedule;
    const { date, shift, nurseId } = input;

    // Sequential: one transaction client never runs queries concurrently.
    const revision =
      schedule.status === "REVISING" || schedule.status === "RETURNED"
        ? await findOpenRevision(uow.tx, schedule.id)
        : null;
    const editable = canEditAssignment({
      status: schedule.status,
      period,
      date,
      revisionDates: revision ? new Set(revision.dates) : null,
    });
    if (!editable.allowed) {
      if (editable.reason === "DATE_OUTSIDE_PERIOD")
        throw new ValidationError(
          "The date is outside the schedule period",
          "date",
        );
      throw new InvalidStateError(
        schedule.status,
        ASSIGNMENT_EDIT_REFUSALS[editable.reason],
      );
    }
    // Checked after authorizing, so an outsider learns nothing from CONFLICT.
    if (schedule.revision !== input.expectedRevision) throw new ConflictError();

    if (!(await lockActiveSchedulingUsers(uow.tx, [nurseId])))
      throw refuse(CANDIDATE_ASSIGNMENT_REFUSALS.NOT_A_CANDIDATE);
    const member = await lockRosterMemberOn(uow.tx, {
      scheduleId: schedule.id,
      onDate: date,
      userId: nurseId,
    });
    if (!member) throw refuse(CANDIDATE_ASSIGNMENT_REFUSALS.NOT_A_CANDIDATE);

    const assignments = await listAssignments(uow.tx, schedule.id);
    const before =
      assignments.find((a) => a.nurseId === nurseId && a.date === date)
        ?.shift ?? null;
    if (candidateDayStatus(before) === null)
      throw refuse(CANDIDATE_ASSIGNMENT_REFUSALS.ALREADY_WORKING);

    const ruleSet = await loadRuleSet(
      uow.tx,
      schedule.staffingRuleSetVersionId,
    );
    const holidays = await holidayDates(uow.holidays, period);
    const requirements = requirementsUnder(ruleSet, [date], holidays);
    if (
      targetCoverage(assignments, requirements, date, shift).status !==
      "BELOW_MINIMUM"
    )
      throw refuse(CANDIDATE_ASSIGNMENT_REFUSALS.NO_SHORTAGE);

    // The nurse's own boundary days: the only ones a change of their cell
    // can be judged by (D7, D20), shifts in this schedule or not.
    const adjacent = await listAdjacentAssignments(uow.tx, {
      departmentId: schedule.departmentId,
      excludeScheduleId: schedule.id,
      nurseIds: [nurseId],
      dates: [addDays(period.start, -1), addDays(period.end, 1)],
    });
    const { assessment } = assessEdits({
      period,
      assignments,
      edits: [{ nurseId, date, shift }],
      adjacentAssignments: adjacent,
      staffingRequirements: requirements,
    });
    if (assessment.blocked) throw new RuleViolationError(assessment.blocking);

    const change: AssignmentChange = { nurseId, date, before, after: shift };
    await writeAssignmentChanges(uow, schedule, [change]);
    const saved = await saveSchedule(uow, schedule, {});
    return { scheduleId: schedule.id, revision: saved.revision, change };
  },
});
