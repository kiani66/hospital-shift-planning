import type { MembershipRole } from "../../domain/authz/actor";
import { decide } from "../../domain/authz/policies";
import {
  isWindowActive,
  preferenceCollectionState,
  type PreferenceCollectionState,
} from "../../domain/preferences/preference-window";
import { eventsFrom } from "../../domain/schedule/state-machine";
import type { ScheduleStatus } from "../../domain/schedule/status";
import type { DateScopeKind } from "../../domain/scope/date-scope";
import {
  compareIsoDates,
  uniqueSortedDates,
  type IsoDate,
} from "../../domain/shared/dates";
import { periodDays, type DatePeriod } from "../../domain/shared/period";
import { listPreferenceWindows } from "../../infrastructure/repositories/preference-windows";
import { listRoster } from "../../infrastructure/repositories/roster";
import { listSchedulesForDepartment } from "../../infrastructure/repositories/schedules";
import { listDisplayNames } from "../../infrastructure/repositories/users";
import { NotFoundError } from "../errors";
import type { AppContext } from "../use-case";
import { summarizeRoster, type RosterSummary } from "./roster-summary";

export interface ScheduleListItem {
  readonly id: string;
  readonly period: DatePeriod;
  readonly label: string;
  readonly status: ScheduleStatus;
}

export interface PreferenceWindowSummary {
  readonly id: string;
  readonly kind: "INITIAL" | "REOPEN";
  readonly scopeKind: DateScopeKind;
  readonly active: boolean;
  readonly firstDate: IsoDate;
  readonly lastDate: IsoDate;
  readonly dateCount: number;
  readonly coversWholePeriod: boolean;
  /** True when the window is for everyone on the roster. */
  readonly allRoster: boolean;
  readonly nurseCount: number;
  readonly openedAt: Date;
  readonly openedBy: string;
  readonly closedAt: Date | null;
  readonly closedBy: string | null;
}

export interface ScheduleOverview extends ScheduleListItem {
  /** Send back with every write (optimistic concurrency). */
  readonly revision: number;
  readonly dayCount: number;
  readonly roster: RosterSummary & {
    readonly members: readonly {
      readonly userId: string;
      readonly displayName: string;
      readonly role: MembershipRole;
    }[];
  };
  readonly preferences: {
    readonly state: PreferenceCollectionState;
    /** Most recent first. */
    readonly windows: readonly PreferenceWindowSummary[];
  };
  /** What the Head Nurse may do now; derived from the state machine and windows. */
  readonly actions: {
    readonly openPreferences: boolean;
    readonly closePreferences: boolean;
  };
}

export interface DepartmentSchedules {
  readonly schedules: readonly ScheduleListItem[];
  readonly selected: ScheduleOverview | null;
}

/**
 * The schedule the page shows when none is requested: the earliest one that
 * has not ended yet (current or upcoming), else the most recent one.
 */
export function defaultSchedule<T extends { period: DatePeriod }>(
  schedules: readonly T[],
  today: IsoDate,
): T | undefined {
  const sorted = [...schedules].sort((a, b) =>
    compareIsoDates(a.period.start, b.period.start),
  );
  return (
    sorted.find((s) => compareIsoDates(s.period.end, today) >= 0) ??
    sorted.at(-1)
  );
}

/**
 * The Head Nurse's schedule management view of one department. Authorized
 * here as well as by the page (`department.manage`); a denied actor gets the
 * same NotFoundError as an unknown department.
 */
export async function getDepartmentSchedules(
  ctx: AppContext,
  input: { departmentId: string; scheduleId?: string; today: IsoDate },
): Promise<DepartmentSchedules> {
  const { db, actor } = ctx;
  if (
    !decide(actor, "department.manage", { departmentId: input.departmentId })
      .allowed
  )
    throw new NotFoundError("Department");

  const all = await listSchedulesForDepartment(db, input.departmentId);
  const schedules = all.map(({ id, period, label, status }) => ({
    id,
    period,
    label,
    status,
  }));
  // Only this department's schedules can be selected; an unknown id falls back.
  const chosen =
    all.find((s) => s.id === input.scheduleId) ??
    defaultSchedule(all, input.today);
  if (!chosen) return { schedules, selected: null };

  const now = ctx.clock?.() ?? new Date();
  const [roster, windows] = await Promise.all([
    listRoster(db, chosen.id),
    listPreferenceWindows(db, chosen.id),
  ]);
  const names = await listDisplayNames(db, [
    ...windows.map((w) => w.openedBy),
    ...windows.flatMap((w) => w.closedBy ?? []),
  ]);
  const days = periodDays(chosen.period);
  const state = preferenceCollectionState(windows, now);

  return {
    schedules,
    selected: {
      id: chosen.id,
      period: chosen.period,
      label: chosen.label,
      status: chosen.status,
      revision: chosen.revision,
      dayCount: days.length,
      roster: { ...summarizeRoster(roster), members: roster },
      preferences: {
        state,
        windows: windows
          .map((w): PreferenceWindowSummary => {
            const dates = uniqueSortedDates(w.dates);
            return {
              id: w.id,
              kind: w.kind,
              scopeKind: w.scopeKind,
              active: isWindowActive(w, now),
              firstDate: dates[0]!,
              lastDate: dates.at(-1)!,
              dateCount: dates.length,
              coversWholePeriod: dates.length === days.length,
              allRoster: w.nurseIds.size === 0,
              nurseCount: w.nurseIds.size || roster.length,
              openedAt: w.openedAt,
              openedBy: names.get(w.openedBy) ?? "—",
              closedAt: w.closedAt,
              closedBy: w.closedBy ? (names.get(w.closedBy) ?? "—") : null,
            };
          })
          .reverse(),
      },
      actions: {
        openPreferences:
          windows.length === 0 &&
          eventsFrom(chosen.status).includes("OPEN_PREFERENCES"),
        closePreferences: state === "OPEN",
      },
    },
  };
}
