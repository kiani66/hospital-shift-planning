import type { MembershipRole } from "../../domain/authz/actor";
import { decide } from "../../domain/authz/policies";
import { toDiagnostic, type Diagnostic } from "../../domain/rules/diagnostic";
import {
  staffingStatus,
  type StaffingBounds,
  type StaffingStatus,
} from "../../domain/rules/staffing";
import { validateSchedule } from "../../domain/rules/validate-schedule";
import {
  assignmentsLockedIn,
  canEditAssignment,
  type AssignmentEditDenial,
} from "../../domain/schedule/assignment-editing";
import {
  DAY_HEALTH_STATES,
  summarizeScheduleDays,
  type DayHealth,
  type ScheduleDaySummary,
} from "../../domain/schedule/day-health";
import type { ScheduleStatus } from "../../domain/schedule/status";
import type { Decision } from "../../domain/shared/decision";
import { addDays, isIsoDate, type IsoDate } from "../../domain/shared/dates";
import { isInPeriod, type DatePeriod } from "../../domain/shared/period";
import {
  COVERAGE_PERIODS,
  SHIFT_CODES,
  type BaseShift,
  type PreferenceValue,
  type ShiftCode,
} from "../../domain/shifts/shift-type";
import {
  listAdjacentAssignments,
  listAssignments,
} from "../../infrastructure/repositories/assignments";
import { listPreferences } from "../../infrastructure/repositories/preferences";
import { findOpenRevision } from "../../infrastructure/repositories/revisions";
import { listRoster } from "../../infrastructure/repositories/roster";
import { findScheduleById } from "../../infrastructure/repositories/schedules";
import {
  NO_HOLIDAY_DATA,
  type HolidayCalendar,
  type OfficialHoliday,
} from "../calendar/holidays";
import { NotFoundError } from "../errors";
import type { AppContext } from "../use-case";
import {
  NO_STAFFING_REQUIREMENTS,
  type StaffingRequirementsSource,
} from "./staffing-requirements";

/**
 * The read-only monthly review of one schedule (Phase 7a): the month as
 * per-day aggregates (health, coverage, finding counts; no people), and, for
 * one selected day, who works which shift and what needs attention.
 *
 * Reads the working copy (`shift_assignments`) in every status. Nothing here
 * writes. Queries per call: the schedule, its assignments, the adjacent
 * schedules' boundary days, holidays; plus the roster and that day's
 * preferences when a day is selected. Never one query per day or per nurse.
 */

export interface ReviewDay extends ScheduleDaySummary {
  /** Independent of `health`: a holiday can be unplanned, valid or need attention. */
  readonly holiday: OfficialHoliday | null;
}

export interface ScheduleMonthReview {
  readonly scheduleId: string;
  readonly period: DatePeriod;
  readonly label: string;
  readonly status: ScheduleStatus;
  /**
   * The schedule revision this review was read at (read before the
   * assignments, so it is never newer than the data shown). Edits send it
   * back; a stale one gets CONFLICT.
   */
  readonly revision: number;
  /**
   * The actor may edit assignments of this schedule now (`assignment.edit`
   * and a status that is not locked). A revision may still limit which days
   * (`DayReview.edit`).
   */
  readonly editable: boolean;
  readonly days: readonly ReviewDay[];
  /** Days per health state. */
  readonly totals: Readonly<Record<DayHealth, number>>;
  /** Findings that belong to no day of the period (shown once for the month). */
  readonly unattributedFindings: number;
}

export interface ReviewNurse {
  readonly userId: string;
  readonly displayName: string;
  readonly role: MembershipRole;
  /** The nurse's own wish for the day (read-only context), if any. */
  readonly preference: PreferenceValue | null;
}

/** A rostered nurse on the selected day, with their shift (null: no shift). */
export interface ReviewRosterNurse extends ReviewNurse {
  readonly shift: ShiftCode | null;
}

export interface ReviewShift {
  readonly code: ShiftCode;
  readonly nurses: readonly ReviewNurse[];
}

export interface ReviewCoverage {
  readonly period: BaseShift;
  /** Nurses staffing the period, ME included for M and E. */
  readonly covered: number;
  readonly bounds: StaffingBounds | null;
  readonly status: StaffingStatus;
}

export interface ReviewFinding extends Diagnostic {
  /** The nurses of `nurseIds`, with names, in the same order. */
  readonly nurses: readonly {
    readonly userId: string;
    readonly displayName: string;
  }[];
}

export interface DayReview {
  readonly date: IsoDate;
  readonly health: DayHealth;
  readonly holiday: OfficialHoliday | null;
  /** M, E, N, ME in that order, each with its nurses (possibly none). */
  readonly shifts: readonly ReviewShift[];
  readonly coverage: readonly ReviewCoverage[];
  readonly findings: readonly ReviewFinding[];
  /**
   * Findings reported on another day that involve this one (a Night here
   * followed by a shift the next day), so editing either day shows them.
   */
  readonly relatedFindings: readonly ReviewFinding[];
  /** Rostered nurses without an assignment that day. */
  readonly unassigned: readonly ReviewNurse[];
  /** Everyone on the roster (sorted by name), assigned or not: the editing list. */
  readonly roster: readonly ReviewRosterNurse[];
  /** Whether the actor may edit this day's assignments, and why not. */
  readonly edit: Decision<AssignmentEditDenial | "NOT_AUTHORIZED">;
}

export interface ScheduleReview {
  readonly month: ScheduleMonthReview;
  /** The requested day, or null when none (or one outside the period) was asked for. */
  readonly day: DayReview | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ReviewSources {
  readonly holidays?: HolidayCalendar;
  readonly staffing?: StaffingRequirementsSource;
}

/**
 * Authorized by `schedule.viewDepartment` (a Head Nurse of the department
 * always, a supervisor from FINALIZED on, D12). A schedule of another
 * department, an unknown id and a denied one are the same NotFoundError.
 */
export async function getScheduleReview(
  ctx: AppContext,
  input: { departmentId: string; scheduleId: string; day?: string },
  sources: ReviewSources = {},
): Promise<ScheduleReview> {
  const { db, actor } = ctx;
  const holidays = sources.holidays ?? NO_HOLIDAY_DATA;
  const staffing = sources.staffing ?? NO_STAFFING_REQUIREMENTS;

  const schedule = UUID.test(input.scheduleId)
    ? await findScheduleById(db, input.scheduleId)
    : null;
  if (
    !schedule ||
    schedule.departmentId !== input.departmentId ||
    !decide(actor, "schedule.viewDepartment", {
      departmentId: schedule.departmentId,
      status: schedule.status,
    }).allowed
  )
    throw new NotFoundError("Schedule");
  const { period } = schedule;

  const assignments = await listAssignments(db, schedule.id);
  const [adjacent, officialHolidays] = await Promise.all([
    // Night-rest holds across schedule boundaries (D7, D20).
    listAdjacentAssignments(db, {
      departmentId: schedule.departmentId,
      excludeScheduleId: schedule.id,
      nurseIds: [...new Set(assignments.map((a) => a.nurseId))],
      dates: [addDays(period.start, -1), addDays(period.end, 1)],
    }),
    holidays.listOfficialHolidays(period),
  ]);
  const diagnostics = validateSchedule({
    period,
    assignments,
    adjacentAssignments: adjacent,
  }).map((v) => toDiagnostic(v, period));
  const summary = summarizeScheduleDays({ period, assignments, diagnostics });

  const holidayOn = new Map(
    officialHolidays
      .filter((h) => isInPeriod(period, h.date))
      .map((h) => [h.date, h]),
  );
  const days = summary.days.map((d): ReviewDay => ({
    ...d,
    holiday: holidayOn.get(d.date) ?? null,
  }));
  const totals = Object.fromEntries(
    DAY_HEALTH_STATES.map((state) => [
      state,
      days.filter((d) => d.health === state).length,
    ]),
  ) as Record<DayHealth, number>;

  const mayEdit = decide(actor, "assignment.edit", {
    departmentId: schedule.departmentId,
  }).allowed;
  const month: ScheduleMonthReview = {
    scheduleId: schedule.id,
    period,
    label: schedule.label,
    status: schedule.status,
    revision: schedule.revision,
    editable: mayEdit && !assignmentsLockedIn(schedule.status),
    days,
    totals,
    unattributedFindings: summary.unattributedFindings,
  };

  const date =
    input.day && isIsoDate(input.day) && isInPeriod(period, input.day)
      ? input.day
      : null;
  if (!date) return { month, day: null };

  // The revision scope matters only once a schedule has been approved (D14).
  const revisionScoped =
    mayEdit &&
    (schedule.status === "REVISING" || schedule.status === "RETURNED");
  const [roster, preferences, requirements, revision] = await Promise.all([
    listRoster(db, schedule.id),
    listPreferences(db, schedule.id, { date }),
    staffing.requirementsFor({
      departmentId: schedule.departmentId,
      dates: [date],
    }),
    revisionScoped ? findOpenRevision(db, schedule.id) : null,
  ]);
  const summaryOfDay = days.find((d) => d.date === date)!;
  const shiftOf = new Map(
    assignments.filter((a) => a.date === date).map((a) => [a.nurseId, a.shift]),
  );
  const preferenceOf = new Map(preferences.map((p) => [p.userId, p.value]));
  const nameOf = new Map(roster.map((r) => [r.userId, r.displayName]));
  const nurse = (r: (typeof roster)[number]): ReviewNurse => ({
    userId: r.userId,
    displayName: r.displayName,
    role: r.role,
    preference: preferenceOf.get(r.userId) ?? null,
  });
  const requirement = requirements.get(date);
  const withNames = (d: Diagnostic): ReviewFinding => ({
    ...d,
    nurses: d.nurseIds.map((id) => ({
      userId: id,
      displayName: nameOf.get(id) ?? "—",
    })),
  });

  return {
    month,
    day: {
      date,
      health: summaryOfDay.health,
      holiday: summaryOfDay.holiday,
      shifts: SHIFT_CODES.map((code) => ({
        code,
        nurses: roster.filter((r) => shiftOf.get(r.userId) === code).map(nurse),
      })),
      coverage: COVERAGE_PERIODS.map((p) => ({
        period: p,
        covered: summaryOfDay.coverage[p],
        bounds: requirement?.[p] ?? null,
        status: staffingStatus(summaryOfDay.coverage[p], requirement?.[p]),
      })),
      findings: diagnostics.filter((d) => d.date === date).map(withNames),
      relatedFindings: diagnostics
        .filter((d) => d.date !== date && d.dates.includes(date))
        .map(withNames),
      unassigned: roster.filter((r) => !shiftOf.has(r.userId)).map(nurse),
      roster: roster.map((r) => ({
        ...nurse(r),
        shift: shiftOf.get(r.userId) ?? null,
      })),
      edit: mayEdit
        ? canEditAssignment({
            status: schedule.status,
            period,
            date,
            revisionDates: revision ? new Set(revision.dates) : null,
          })
        : { allowed: false, reason: "NOT_AUTHORIZED" },
    },
  };
}
