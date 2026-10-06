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
  type RosteredScheduleRecord,
  type ScheduleRecord,
} from "../../infrastructure/repositories/schedules";
import {
  NO_HOLIDAY_DATA,
  type HolidayCalendar,
  type OfficialHoliday,
} from "../calendar/holidays";
import { NotFoundError } from "../errors";
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
  /** Informational only: a holiday never changes what may be preferred. */
  readonly holiday: OfficialHoliday | null;
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
  /** The calendar month shown (a whole month of the caller's calendar). */
  readonly month: DatePeriod;
  /** Schedules still current or open (shortcuts to their months), oldest first. */
  readonly schedules: readonly MyPreferenceScheduleItem[];
  /**
   * Visible schedules sharing a day with `month`, oldest first, ended ones
   * included (history stays readable). Usually one; one per department when
   * the actor is rostered in two.
   */
  readonly monthSchedules: readonly MyPreferenceScheduleItem[];
  readonly selected: MyPreferenceSchedule | null;
  /** A requested schedule was not visible (unknown, foreign or out of scope). */
  readonly requestedNotFound: boolean;
}

/**
 * The calendar the page navigates by. Calendar conversion is presentation
 * (the Jalali adapter), so the page hands it in; this layer only sees ISO
 * periods.
 */
export interface PreferenceMonthCalendar {
  /** The whole calendar month containing `date`. */
  monthOf(date: IsoDate): DatePeriod;
}

export interface MyPreferenceSources {
  readonly holidays?: HolidayCalendar;
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
  sources: MyPreferenceSources = {},
): Promise<MyPreferenceSchedule> {
  const visible = await loadVisible(ctx.db, ctx.actor, input.scheduleId);
  if (!visible) throw new NotFoundError("Schedule");
  const department = await findDepartmentById(
    ctx.db,
    visible.schedule.departmentId,
  );
  return describeMyPreferences(
    ctx,
    visible.schedule,
    visible.windows,
    department?.name ?? "",
    sources,
  );
}

async function describeMyPreferences(
  ctx: AppContext,
  schedule: ScheduleRecord,
  windows: readonly PreferenceWindowRecord[],
  departmentName: string,
  sources: MyPreferenceSources,
): Promise<MyPreferenceSchedule> {
  const { db, actor } = ctx;
  const now = nowOf(ctx);
  const holidays = sources.holidays ?? NO_HOLIDAY_DATA;

  const [stored, officialHolidays] = await Promise.all([
    listPreferences(db, schedule.id, { userId: actor.userId }),
    holidays.listOfficialHolidays(schedule.period),
  ]);
  const values = new Map(stored.map((p) => [p.date, p.value]));
  const holidayOn = new Map(officialHolidays.map((h) => [h.date, h]));
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
      holiday: holidayOn.get(date) ?? null,
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
    departmentName,
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

const overlaps = (a: DatePeriod, b: DatePeriod) =>
  compareIsoDates(a.start, b.end) <= 0 && compareIsoDates(a.end, b.start) >= 0;

/**
 * The visible schedules sharing a day with `period`, ended ones included
 * (a closed month stays readable as history), oldest first.
 */
async function visibleInPeriod(
  ctx: AppContext,
  period: DatePeriod,
): Promise<
  { schedule: RosteredScheduleRecord; windows: PreferenceWindowRecord[] }[]
> {
  const { db, actor } = ctx;
  if (!actor.isActive) return [];
  const rostered = (await listSchedulesOnRoster(db, actor.userId)).filter((s) =>
    overlaps(s.period, period),
  );
  const visible = await Promise.all(
    rostered.map(async (schedule) => {
      const windows = myWindows(
        actor,
        schedule,
        await listPreferenceWindows(db, schedule.id),
      );
      return windows ? { schedule, windows } : null;
    }),
  );
  return visible.filter((v) => v !== null);
}

/**
 * What `/preferences` shows: one calendar month and, in it, one schedule.
 *
 * - A requested schedule (`?schedule=`, e.g. from a PREFERENCES_OPENED
 *   notification) is authorized here, never trusted, and selects its month.
 *   When it is not visible the page says so without detail and falls back.
 * - Otherwise the requested month (`?month=`), else the month of the
 *   earliest schedule whose collection is open for the actor, else the
 *   current month.
 *
 * Every month can be shown (navigation is by calendar month, open or not);
 * a month without a visible schedule simply has no selection. In a month
 * with two departments' schedules, the open one is shown first.
 */
export async function getMyPreferencesPage(
  ctx: AppContext,
  input: {
    scheduleId?: string;
    month?: DatePeriod;
    today: IsoDate;
    calendar: PreferenceMonthCalendar;
  },
  sources: MyPreferenceSources = {},
): Promise<MyPreferencesPage> {
  const schedules = await getMyPreferenceSchedules(ctx, input);
  let requested: MyPreferenceSchedule | null = null;
  if (input.scheduleId !== undefined) {
    try {
      requested = await getMyPreferences(
        ctx,
        { scheduleId: input.scheduleId },
        sources,
      );
    } catch (error) {
      if (!(error instanceof NotFoundError)) throw error;
    }
  }
  const requestedNotFound = input.scheduleId !== undefined && !requested;

  const earliestOpen = schedules.find((s) => s.state === "OPEN");
  const month = requested
    ? input.calendar.monthOf(requested.period.start)
    : (input.month ??
      input.calendar.monthOf(earliestOpen?.period.start ?? input.today));

  // The requested schedule's own month always contains it.
  const inMonth = await visibleInPeriod(ctx, month);
  const now = nowOf(ctx);
  const monthSchedules = inMonth.map(
    ({ schedule, windows }): MyPreferenceScheduleItem => ({
      id: schedule.id,
      label: schedule.label,
      departmentName: schedule.departmentName,
      period: schedule.period,
      state: preferenceCollectionState(windows, now),
    }),
  );
  const chosen =
    inMonth[monthSchedules.findIndex((m) => m.state === "OPEN")] ?? inMonth[0];
  const selected =
    requested ??
    (chosen
      ? await describeMyPreferences(
          ctx,
          chosen.schedule,
          chosen.windows,
          chosen.schedule.departmentName,
          sources,
        )
      : null);

  return { month, schedules, monthSchedules, selected, requestedNotFound };
}
