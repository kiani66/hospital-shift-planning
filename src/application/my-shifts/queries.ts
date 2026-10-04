import { decide } from "../../domain/authz/policies";
import { acceptsChangeRequests } from "../../domain/change-requests/model";
import {
  shiftPublication,
  type ShiftPublication,
  type VisibleShiftPublication,
} from "../../domain/schedule/publication";
import type { ScheduleStatus } from "../../domain/schedule/status";
import { nurseScheduleView } from "../../domain/schedule/visibility";
import { compareIsoDates, type IsoDate } from "../../domain/shared/dates";
import {
  createPeriod,
  isInPeriod,
  periodDays,
  type DatePeriod,
} from "../../domain/shared/period";
import { unwrap } from "../../domain/shared/result";
import type { ShiftCode } from "../../domain/shifts/shift-type";
import {
  summarizeShifts,
  type ShiftTotals,
} from "../../domain/shifts/working-time";
import { listAssignments } from "../../infrastructure/repositories/assignments";
import { findOpenRevision } from "../../infrastructure/repositories/revisions";
import {
  listSchedulesOnRoster,
  type RosteredScheduleRecord,
} from "../../infrastructure/repositories/schedules";
import { listVersionAssignments } from "../../infrastructure/repositories/versions";
import type { AppContext } from "../use-case";

/**
 * The nurse's own shifts for one calendar period (a Jalali month on the
 * page). Everything is scoped to the trusted actor: the only nurse ever read
 * is `actor.userId`, and the input has no user id to send. A schedule counts
 * when the actor is on its roster (D21, D95) and `schedule.viewOwn` allows it
 * (a current member, or a former one keeping history, D16); what is shown of
 * it is D11's `nurseScheduleView`: nothing while planning, the finalized
 * working copy until the first approval, then only the latest approved
 * version (unapproved revision edits stay hidden; their days are flagged).
 *
 * Reads only. One query for the rosters, then one or two per schedule
 * overlapping the period (the open revision, the actor's own cells),
 * independent of department size.
 */

export interface MyShiftEntry {
  readonly scheduleId: string;
  readonly shift: ShiftCode;
  readonly publication: VisibleShiftPublication;
  /**
   * The day is in an open revision of the approved schedule: a change may
   * be on its way, but the shift shown stays the approved one until then.
   */
  readonly changePending: boolean;
  /**
   * A change request may be made for this shift now (D13, D66): a current
   * member, a schedule from FINALIZED on, and a day that is not past.
   * Guidance for a link only; the request use case decides again.
   */
  readonly requestable: boolean;
}

export interface MyShiftDay {
  readonly date: IsoDate;
  /** Usually zero or one; one per schedule when two departments overlap. */
  readonly entries: readonly MyShiftEntry[];
  /** Approved, but in an open revision; the actor has no shift that day. */
  readonly changePending: boolean;
}

export interface MyShiftSchedule {
  readonly id: string;
  readonly label: string;
  readonly departmentName: string;
  readonly period: DatePeriod;
  readonly status: ScheduleStatus;
  readonly publication: ShiftPublication;
  /** The actor's visible shifts of this schedule inside the requested period. */
  readonly shiftCount: number;
  /** Days of the requested period in an open revision (OFFICIAL only). */
  readonly pendingChangeDates: readonly IsoDate[];
}

export interface MyShiftsMonth {
  readonly period: DatePeriod;
  /** The actor is on at least one schedule's roster they may view, any month. */
  readonly onAnyRoster: boolean;
  /** Schedules overlapping the period, oldest first. */
  readonly schedules: readonly MyShiftSchedule[];
  /** Every day of the period, in order. */
  readonly days: readonly MyShiftDay[];
  /** Over the visible shifts of the period. */
  readonly totals: ShiftTotals & {
    /** Some counted shift is not approved yet (TEMPORARY / AWAITING_APPROVAL). */
    readonly includesUnapproved: boolean;
  };
}

const overlaps = (a: DatePeriod, b: DatePeriod) =>
  compareIsoDates(a.start, b.end) <= 0 && compareIsoDates(a.end, b.start) >= 0;

/** What the actor sees of one schedule (D11), limited to `period`. */
async function visibleSchedule(
  ctx: AppContext,
  schedule: RosteredScheduleRecord,
  period: DatePeriod,
  today: IsoDate,
): Promise<{ summary: MyShiftSchedule; entries: Map<IsoDate, MyShiftEntry> }> {
  const { db, actor } = ctx;
  const approved = schedule.currentVersionId !== null;
  // Revision days matter only while an approved schedule is being revised.
  const revision =
    approved && schedule.status !== "APPROVED"
      ? await findOpenRevision(db, schedule.id)
      : null;
  const view = nurseScheduleView({
    status: schedule.status,
    hasApprovedVersion: approved,
    revisionDates: revision?.dates,
  });
  const publication = shiftPublication(schedule.status, view);
  const pendingChangeDates =
    view.source === "APPROVED_VERSION"
      ? view.pendingChangeDates.filter((d) => isInPeriod(period, d))
      : [];

  const cells =
    view.source === "APPROVED_VERSION"
      ? await listVersionAssignments(db, schedule.currentVersionId!, {
          userId: actor.userId,
        })
      : view.source === "WORKING_COPY"
        ? await listAssignments(db, schedule.id, { userId: actor.userId })
        : [];

  const requestsOpen =
    acceptsChangeRequests(schedule.status) &&
    decide(actor, "changeRequest.submit", {
      departmentId: schedule.departmentId,
      status: schedule.status,
    }).allowed;
  const pending = new Set(pendingChangeDates);
  const entries = new Map<IsoDate, MyShiftEntry>();
  for (const cell of cells) {
    // Defensive: only the actor's own cells of this schedule's days count.
    if (
      cell.nurseId !== actor.userId ||
      !isInPeriod(schedule.period, cell.date) ||
      !isInPeriod(period, cell.date) ||
      publication === "NOT_PUBLISHED"
    )
      continue;
    entries.set(cell.date, {
      scheduleId: schedule.id,
      shift: cell.shift,
      publication,
      changePending: pending.has(cell.date),
      requestable: requestsOpen && compareIsoDates(cell.date, today) >= 0,
    });
  }

  return {
    summary: {
      id: schedule.id,
      label: schedule.label,
      departmentName: schedule.departmentName,
      period: schedule.period,
      status: schedule.status,
      publication,
      shiftCount: entries.size,
      pendingChangeDates,
    },
    entries,
  };
}

export async function getMyShiftsMonth(
  ctx: AppContext,
  input: { period: DatePeriod; today: IsoDate },
): Promise<MyShiftsMonth> {
  const period = unwrap(createPeriod(input.period.start, input.period.end));
  const { db, actor } = ctx;
  const rostered = (await listSchedulesOnRoster(db, actor.userId)).filter(
    (s) =>
      decide(actor, "schedule.viewOwn", {
        departmentId: s.departmentId,
        onRoster: true,
      }).allowed,
  );
  const shown = await Promise.all(
    rostered
      .filter((s) => overlaps(s.period, period))
      .map((s) => visibleSchedule(ctx, s, period, input.today)),
  );

  const days = periodDays(period).map((date): MyShiftDay => {
    const entries = shown.flatMap((s) => s.entries.get(date) ?? []);
    return {
      date,
      entries,
      changePending:
        entries.length === 0 &&
        shown.some((s) => s.summary.pendingChangeDates.includes(date)),
    };
  });
  const visible = days.flatMap((d) => d.entries);

  return {
    period,
    onAnyRoster: rostered.length > 0,
    schedules: shown.map((s) => s.summary),
    days,
    totals: {
      ...summarizeShifts(visible.map((e) => e.shift)),
      includesUnapproved: visible.some((e) => e.publication !== "OFFICIAL"),
    },
  };
}
