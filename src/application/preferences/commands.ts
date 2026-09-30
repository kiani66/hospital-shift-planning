import { z } from "zod";

import {
  preferenceDayAccess,
  windowsForNurse,
} from "../../domain/preferences/my-preferences";
import { isIsoDate, type IsoDate } from "../../domain/shared/dates";
import { ForbiddenError } from "../../domain/shared/errors";
import {
  PREFERENCE_VALUES,
  type PreferenceValue,
} from "../../domain/shifts/shift-type";
import { listPreferenceWindows } from "../../infrastructure/repositories/preference-windows";
import {
  clearPreference,
  findPreference,
  setPreference,
} from "../../infrastructure/repositories/preferences";
import { lockRosterEntry } from "../../infrastructure/repositories/roster";
import {
  lockScheduleForShare,
  type ScheduleRecord,
} from "../../infrastructure/repositories/schedules";
import { NotFoundError } from "../errors";
import { defineCommand, type UnitOfWork } from "../use-case";

/**
 * The nurse's own preference writes. The client sends a schedule, a date and
 * a value, never a user id: the target nurse is always the trusted actor
 * (unknown keys are stripped by the schema, so a tampered `userId` is
 * ignored).
 *
 * Concurrency, inside the one transaction of `defineCommand`:
 * - the schedule row is locked `FOR SHARE`, so closing preference collection
 *   (which locks it `FOR UPDATE`) and a save are serialized: a save either
 *   commits before the close or sees the closed window and is rejected;
 * - the actor's roster row is locked, so their own tabs and devices apply one
 *   write at a time (accurate audit of the previous value), while other
 *   nurses are not blocked;
 * - the primary key `(schedule_id, user_id, date)` stays the final guard
 *   against a second row.
 *
 * Preferences are wishes, not assignments: the night-rest rule and coverage
 * rules are not applied here.
 */

const preferenceRef = {
  scheduleId: z.uuid(),
  date: z
    .string()
    .refine(isIsoDate, "Expected a YYYY-MM-DD date")
    .transform((value) => value as IsoDate),
};

export interface MyPreferenceWriteOutput {
  readonly date: IsoDate;
  /** The stored value after the write; null when there is none. */
  readonly value: PreferenceValue | null;
  /** False when the request repeated the stored state (nothing written or audited). */
  readonly changed: boolean;
}

/**
 * Locks, authorizes and checks that the actor may edit their own preference
 * for `date` right now. A schedule that is unknown, that the actor is not on
 * the roster of, or whose windows never include them is NOT_FOUND (nothing
 * about it is revealed). A visible but read-only day is FORBIDDEN with the
 * day's lock reason (e.g. WINDOW_CLOSED).
 */
async function loadForOwnPreference(
  uow: UnitOfWork,
  scheduleId: string,
  date: IsoDate,
): Promise<ScheduleRecord> {
  const schedule = await lockScheduleForShare(uow.tx, scheduleId);
  if (!schedule) throw new NotFoundError("Schedule");
  const userId = uow.actor.userId;
  if (!(await lockRosterEntry(uow.tx, schedule.id, userId)))
    throw new NotFoundError("Schedule");
  // Read after the schedule lock: reflects any close committed before it.
  const windows = windowsForNurse(
    await listPreferenceWindows(uow.tx, schedule.id),
    userId,
  );
  if (windows.length === 0) throw new NotFoundError("Schedule");

  uow.authorize("preference.editOwn", { departmentId: schedule.departmentId });
  const access = preferenceDayAccess({
    nurseId: userId,
    date,
    schedule: { status: schedule.status, period: schedule.period },
    onRoster: true,
    windows,
    now: uow.now,
  });
  if (!access.allowed) throw new ForbiddenError(access.reason);
  return schedule;
}

/** Sets (creates or replaces) the actor's preference for one day. Repeating it is a no-op. */
export const setMyPreference = defineCommand({
  name: "preference.setOwn",
  input: z.object({
    ...preferenceRef,
    value: z.enum(PREFERENCE_VALUES),
  }),
  async handler(uow, input): Promise<MyPreferenceWriteOutput> {
    const schedule = await loadForOwnPreference(
      uow,
      input.scheduleId,
      input.date,
    );
    const key = {
      scheduleId: schedule.id,
      userId: uow.actor.userId,
      date: input.date,
    };
    const before = await findPreference(uow.tx, key);
    if (before === input.value)
      return { date: input.date, value: before, changed: false };

    await setPreference(uow.tx, { ...key, value: input.value });
    await uow.audit({
      action: before === null ? "preference.created" : "preference.changed",
      entityType: "preference",
      entityId: `${key.userId}:${key.date}`,
      departmentId: schedule.departmentId,
      scheduleId: schedule.id,
      data: { date: input.date, before, after: input.value },
    });
    return { date: input.date, value: input.value, changed: true };
  },
});

/** Removes the actor's preference for one day ("no preference"). Repeating it is a no-op. */
export const clearMyPreference = defineCommand({
  name: "preference.clearOwn",
  input: z.object(preferenceRef),
  async handler(uow, input): Promise<MyPreferenceWriteOutput> {
    const schedule = await loadForOwnPreference(
      uow,
      input.scheduleId,
      input.date,
    );
    const key = {
      scheduleId: schedule.id,
      userId: uow.actor.userId,
      date: input.date,
    };
    const before = await findPreference(uow.tx, key);
    if (before === null)
      return { date: input.date, value: null, changed: false };

    await clearPreference(uow.tx, key);
    await uow.audit({
      action: "preference.cleared",
      entityType: "preference",
      entityId: `${key.userId}:${key.date}`,
      departmentId: schedule.departmentId,
      scheduleId: schedule.id,
      data: { date: input.date, before, after: null },
    });
    return { date: input.date, value: null, changed: true };
  },
});
