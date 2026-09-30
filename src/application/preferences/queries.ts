import type { Actor } from "../../domain/authz/actor";
import { decide } from "../../domain/authz/policies";
import {
  preferenceDayAccess,
  summarizePreferences,
  windowDates,
  windowsForNurse,
  type PreferenceDayLock,
  type PreferenceSummary,
} from "../../domain/preferences/my-preferences";
import {
  isWindowActive,
  preferenceCollectionState,
  type PreferenceCollectionState,
} from "../../domain/preferences/preference-window";
import type { ScheduleStatus } from "../../domain/schedule/status";
import {
  compareIsoDates,
  uniqueSortedDates,
  type IsoDate,
} from "../../domain/shared/dates";
import { periodDays, type DatePeriod } from "../../domain/shared/period";
import type { PreferenceValue } from "../../domain/shifts/shift-type";
import type { DbExecutor } from "../../infrastructure/db/database";
import { findDepartmentById } from "../../infrastructure/repositories/departments";
import {
  listPreferenceWindows,
  type PreferenceWindowRecord,
} from "../../infrastructure/repositories/preference-windows";
import { listPreferences } from "../../infrastructure/repositories/preferences";
import { isOnRoster } from "../../infrastructure/repositories/roster";
import {
  findScheduleById,
  listSchedulesOnRoster,
  type ScheduleRecord,
} from "../../infrastructure/repositories/schedules";
import { NotFoundError } from "../errors";
import { defaultSchedule } from "../schedules/queries";
import type { AppContext } from "../use-case";

/**
 * The nurse's own preference entry (Phase 6). Everything is scoped to the
 * trusted actor: the target nurse is always `actor.userId`, never an id from
 * the request, and no other nurse's preferences are ever loaded.
 *
 * A schedule is visible here when the actor is on its roster and at least one
 * of its preference windows (open or closed) includes them. Anything else, an
 * unknown id included, is the same NotFoundError.
 */

export interface MyPreferenceScheduleItem {
  readonly id: string;
  readonly label: string;
  readonly departmentName: string;
  readonly period: DatePeriod;
  /** Preference collection as it applies to the actor (their windows only). */
  readonly state: PreferenceCollectionState;
}

/** Why a day is read-only; null when the actor may edit it now. */
export type MyPreferenceLock =
  | PreferenceDayLock
  /** The actor's membership of the department ended (history stays readable, D16). */
  | "NOT_MEMBER";

export interface MyPreferenceDay {
  readonly date: IsoDate;
  readonly value: PreferenceValue | null;
  readonly lock: MyPreferenceLock | null;
}

export interface MyPreferenceSchedule extends MyPreferenceScheduleItem {
  readonly status: ScheduleStatus;
  /** At least one day can be edited now. */
  readonly editable: boolean;
  /**
   * The dates the actor's windows cover: the active ones while open, else all
   * of them (what was open before closing).
   */
  readonly window: {
    readonly firstDate: IsoDate;
    readonly lastDate: IsoDate;
    readonly dateCount: number;
    /** Earliest deadline of an active window, if any. */
    readonly closesAt: Date | null;
    /** When collection ended for the actor (latest close or passed deadline). */
    readonly closedAt: Date | null;
  };
  readonly days: readonly MyPreferenceDay[];
  readonly summary: PreferenceSummary;
}

export interface MyPreferencesPage {
  readonly schedules: readonly MyPreferenceScheduleItem[];
  readonly selected: MyPreferenceSchedule | null;
  /** A requested schedule was not visible (unknown, foreign or out of scope). */
  readonly requestedNotFound: boolean;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const nowOf = (ctx: AppContext) => ctx.clock?.() ?? new Date();

/**
 * The actor's windows of a schedule they are rostered on, or null when the
 * schedule is not visible to them (no window includes them, or the actor may
 * not view their own schedules at all, e.g. deactivated).
 */
function myWindows(
  actor: Actor,
  schedule: ScheduleRecord,
  windows: readonly PreferenceWindowRecord[],
): PreferenceWindowRecord[] | null {
  if (
    !decide(actor, "schedule.viewOwn", {
      departmentId: schedule.departmentId,
      onRoster: true,
    }).allowed
  )
    return null;
  const mine = windowsForNurse(windows, actor.userId);
  return mine.length > 0 ? mine : null;
}

async function loadVisible(
  db: DbExecutor,
  actor: Actor,
  scheduleId: string,
): Promise<{
  schedule: ScheduleRecord;
  windows: PreferenceWindowRecord[];
} | null> {
  if (!UUID.test(scheduleId)) return null;
  const schedule = await findScheduleById(db, scheduleId);
  if (!schedule || !(await isOnRoster(db, schedule.id, actor.userId)))
    return null;
  const windows = myWindows(
    actor,
    schedule,
    await listPreferenceWindows(db, schedule.id),
  );
  return windows ? { schedule, windows } : null;
}

/**
 * Schedules the actor can enter (or review) preferences for: rostered, with a
 * window that includes them, and either not ended yet or still open.
 * Oldest period first. Several may be visible (two departments, two months).
 */
export async function getMyPreferenceSchedules(
  ctx: AppContext,
  input: { today: IsoDate },
): Promise<MyPreferenceScheduleItem[]> {
  const { db, actor } = ctx;
  if (!actor.isActive) return [];
  const now = nowOf(ctx);
  const rostered = await listSchedulesOnRoster(db, actor.userId);
  const items = await Promise.all(
    rostered.map(async (schedule) => {
      const mine = myWindows(
        actor,
        schedule,
        await listPreferenceWindows(db, schedule.id),
      );
      if (!mine) return null;
      const state = preferenceCollectionState(mine, now);
      const current = compareIsoDates(schedule.period.end, input.today) >= 0;
      if (!current && state !== "OPEN") return null;
      return {
        id: schedule.id,
        label: schedule.label,
        departmentName: schedule.departmentName,
        period: schedule.period,
        state,
      } satisfies MyPreferenceScheduleItem;
    }),
  );
  return items.filter((item) => item !== null);
}

/**
 * The actor's own preferences for one schedule, day by day, with the reason
 * each read-only day cannot be edited. Unknown, foreign and out-of-scope
 * schedules all raise the same NotFoundError.
 */
export async function getMyPreferences(
  ctx: AppContext,
  input: { scheduleId: string },
): Promise<MyPreferenceSchedule> {
  const { db, actor } = ctx;
  const visible = await loadVisible(db, actor, input.scheduleId);
  if (!visible) throw new NotFoundError("Schedule");
  const { schedule, windows } = visible;
  const now = nowOf(ctx);

  const [department, stored] = await Promise.all([
    findDepartmentById(db, schedule.departmentId),
    listPreferences(db, schedule.id, { userId: actor.userId }),
  ]);
  const values = new Map(stored.map((p) => [p.date, p.value]));
  const member = decide(actor, "preference.editOwn", {
    departmentId: schedule.departmentId,
  }).allowed;

  const days = periodDays(schedule.period).map((date): MyPreferenceDay => {
    const access = preferenceDayAccess({
      nurseId: actor.userId,
      date,
      schedule: { status: schedule.status, period: schedule.period },
      onRoster: true,
      windows,
      now,
    });
    return {
      date,
      value: values.get(date) ?? null,
      lock: !member ? "NOT_MEMBER" : access.allowed ? null : access.reason,
    };
  });

  const active = windows.filter((w) => isWindowActive(w, now));
  const shown = uniqueSortedDates(
    windowDates(active.length ? active : windows),
  );
  const deadlines = active.flatMap((w) => w.closesAt ?? []);
  const ended = windows.flatMap((w) => w.closedAt ?? w.closesAt ?? []);

  return {
    id: schedule.id,
    label: schedule.label,
    departmentName: department?.name ?? "",
    period: schedule.period,
    status: schedule.status,
    state: preferenceCollectionState(windows, now),
    editable: days.some((d) => d.lock === null),
    window: {
      firstDate: shown[0]!,
      lastDate: shown.at(-1)!,
      dateCount: shown.length,
      closesAt: deadlines.length
        ? new Date(Math.min(...deadlines.map((d) => d.getTime())))
        : null,
      closedAt:
        active.length === 0 && ended.length
          ? new Date(Math.max(...ended.map((d) => d.getTime())))
          : null,
    },
    days,
    summary: summarizePreferences(stored.map((p) => p.value)),
  };
}

/**
 * What `/preferences` shows. A requested schedule (e.g. from a
 * PREFERENCES_OPENED notification) is authorized here, never trusted; when it
 * is not visible the page says so without detail and falls back to the
 * default: the first schedule still open, else the current or next one.
 */
export async function getMyPreferencesPage(
  ctx: AppContext,
  input: { scheduleId?: string; today: IsoDate },
): Promise<MyPreferencesPage> {
  const schedules = await getMyPreferenceSchedules(ctx, input);
  const load = async (id: string) => {
    try {
      return await getMyPreferences(ctx, { scheduleId: id });
    } catch (error) {
      if (error instanceof NotFoundError) return null;
      throw error;
    }
  };

  const requested = input.scheduleId ? await load(input.scheduleId) : null;
  const requestedNotFound = input.scheduleId !== undefined && !requested;
  if (requested) {
    // A directly opened schedule the list filters out (e.g. ended) still shows.
    const listed = schedules.some((s) => s.id === requested.id);
    const { id, label, departmentName, period, state } = requested;
    return {
      schedules: listed
        ? schedules
        : [...schedules, { id, label, departmentName, period, state }],
      selected: requested,
      requestedNotFound,
    };
  }

  const fallback =
    schedules.find((s) => s.state === "OPEN") ??
    defaultSchedule(schedules, input.today);
  return {
    schedules,
    selected: fallback ? await load(fallback.id) : null,
    requestedNotFound,
  };
}
