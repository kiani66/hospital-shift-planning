import { decide } from "../../domain/authz/policies";
import { acceptsChangeRequests } from "../../domain/change-requests/model";
import { addDays, type IsoDate } from "../../domain/shared/dates";
import { isInPeriod, type DatePeriod } from "../../domain/shared/period";
import {
  assignmentInterval,
  intervalsOverlap,
} from "../../domain/shifts/interval";
import { isWorkingShift } from "../../domain/shifts/shift-type";
import { listAssignmentsFor } from "../../infrastructure/repositories/assignments";
import { listChangeRequestsForUser } from "../../infrastructure/repositories/change-requests";
import { listSchedulingRoster } from "../../infrastructure/repositories/roster";
import { findScheduleById } from "../../infrastructure/repositories/schedules";
import {
  findVersionById,
  listVersionAssignmentsFor,
} from "../../infrastructure/repositories/versions";
import { zonedInstantAt } from "../../infrastructure/time/zoned-time";
import type { AppContext } from "../use-case";
import {
  getMyShiftsPeriods,
  type MyShiftEntry,
  type MyShiftSchedule,
} from "./queries";

export interface CoworkerGroup {
  readonly scheduleId: string;
  readonly departmentName: string;
  readonly shift: MyShiftEntry["shift"];
  readonly available: boolean;
  /** Names only: no personnel numbers, contacts, preferences or other days. */
  readonly names: readonly string[];
}

/**
 * Read-only coherent snapshot. Identity always comes from ctx.actor. Own-shift
 * sources stay D11; coworker disclosure uses the existing request-partner
 * boundary (D13): current member, on roster, FINALIZED onward, approved
 * snapshot during revisions. No department grid permission is added.
 */
export async function getNurseDashboard(
  ctx: AppContext,
  input: {
    month: DatePeriod;
    calendar: DatePeriod;
    selected: IsoDate | null;
    today: IsoDate;
  },
) {
  return ctx.db.transaction(
    async (db) => {
      const data = await getMyShiftsPeriods(
        { db, actor: ctx.actor },
        {
          periods: [input.month, input.calendar],
          today: input.today,
          includeUpcoming: true,
        },
      );
      const [month, calendar] = data.periods;
      const selectedDay = calendar!.days.find((d) => d.date === input.selected);
      const coworkers = await Promise.all(
        (selectedDay?.entries ?? [])
          .filter((entry) => isWorkingShift(entry.shift))
          .map(async (entry): Promise<CoworkerGroup> => {
            const summary = calendar!.schedules.find(
              (s) => s.id === entry.scheduleId,
            )!;
            const empty = (available: boolean): CoworkerGroup => ({
              scheduleId: summary.id,
              departmentName: summary.departmentName,
              shift: entry.shift,
              available,
              names: [],
            });
            if (!maySeeCoworkers(ctx, summary)) return empty(false);
            const schedule = await findScheduleById(db, summary.id);
            if (!schedule || !isInPeriod(schedule.period, selectedDay!.date))
              return empty(false);
            // Fail closed on inconsistent approved pointers; never use revision edits.
            if (schedule.currentVersionId) {
              const version = await findVersionById(
                db,
                schedule.currentVersionId,
              );
              if (version?.scheduleId !== schedule.id) return empty(false);
            } else if (
              schedule.status === "APPROVED" ||
              schedule.status === "REVISING"
            )
              return empty(false);
            const roster = await listSchedulingRoster(db, schedule.id);
            const nurseIds = roster
              .filter((r) => r.userId !== ctx.actor.userId)
              .map((r) => r.userId);
            // Catalog shifts last at most one day; only adjacent assignment dates
            // can intersect. Exact interval comparison below remains authoritative.
            const dates = [-1, 0, 1]
              .map((offset) => addDays(selectedDay!.date, offset))
              .filter((date) => isInPeriod(schedule.period, date));
            const cells = schedule.currentVersionId
              ? await listVersionAssignmentsFor(db, {
                  versionId: schedule.currentVersionId,
                  nurseIds,
                  dates,
                })
              : await listAssignmentsFor(db, {
                  scheduleId: schedule.id,
                  nurseIds,
                  dates,
                });
            const instantAt = zonedInstantAt(summary.timezone);
            const mine = assignmentInterval(
              selectedDay!.date,
              entry.shift,
              instantAt,
            )!;
            const overlapping = new Set(
              cells
                .filter((cell) => {
                  if (
                    cell.nurseId === ctx.actor.userId ||
                    !isInPeriod(schedule.period, cell.date)
                  )
                    return false;
                  const interval = assignmentInterval(
                    cell.date,
                    cell.shift,
                    instantAt,
                  );
                  return interval !== null && intervalsOverlap(mine, interval);
                })
                .map((cell) => cell.nurseId),
            );
            return {
              ...empty(true),
              names: roster
                .filter((r) => overlapping.has(r.userId))
                .map((r) => r.displayName),
            };
          }),
      );
      // Existing repository and request policies; no per-request context/partner queries.
      const requests = (await listChangeRequestsForUser(db, ctx.actor.userId))
        .filter(
          (r) =>
            decide(ctx.actor, "changeRequest.view", {
              departmentId: r.departmentId,
              requesterId: r.requesterId,
              counterpartId: r.counterpartId,
            }).allowed,
        )
        .slice(0, 3)
        .map((r) => ({
          id: r.id,
          type: r.type,
          status: r.status,
          consent: r.consent,
          date: r.date,
        }));
      const clocks = new Map<string, ReturnType<typeof zonedInstantAt>>();
      const clockFor = (timezone: string) => {
        if (!clocks.has(timezone))
          clocks.set(timezone, zonedInstantAt(timezone));
        return clocks.get(timezone)!;
      };
      return {
        month: month!,
        calendar: calendar!,
        coworkers,
        requests,
        upcoming: data.upcoming.flatMap((shift) => {
          const interval = assignmentInterval(
            shift.date,
            shift.entry.shift,
            clockFor(shift.timezone),
          );
          return interval ? [{ ...shift, ...interval }] : [];
        }),
        upcomingOffDates: month!.days
          .filter(
            (d) =>
              d.date >= input.today && d.entries.some((e) => e.shift === "OFF"),
          )
          .map((d) => d.date),
      };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}

function maySeeCoworkers(ctx: AppContext, schedule: MyShiftSchedule): boolean {
  return (
    acceptsChangeRequests(schedule.status) &&
    decide(ctx.actor, "changeRequest.submit", {
      departmentId: schedule.departmentId,
      status: schedule.status,
    }).allowed
  );
}

export type NurseDashboard = Awaited<ReturnType<typeof getNurseDashboard>>;
