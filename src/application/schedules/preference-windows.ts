import { z } from "zod";

import {
  checkWindowNurses,
  countActiveWindows,
} from "../../domain/preferences/preference-window";
import { transition } from "../../domain/schedule/state-machine";
import { expandDateScope } from "../../domain/scope/date-scope";
import { InvalidStateError } from "../../domain/shared/errors";
import { unwrap } from "../../domain/shared/result";
import {
  closeOpenPreferenceWindowIds,
  createPreferenceWindow,
  listPreferenceWindows,
} from "../../infrastructure/repositories/preference-windows";
import { listRoster } from "../../infrastructure/repositories/roster";
import { ConflictError } from "../errors";
import { defineCommand } from "../use-case";
import { loadScheduleForUpdate, saveSchedule } from "./load-for-update";

/** Mirrors the domain `DateScopeInput`; the domain validates the dates themselves. */
const dateScopeInput = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("DAY"), date: z.string() }),
  z.object({
    kind: z.literal("DAYS"),
    dates: z.array(z.string()).max(62),
  }),
  z.object({ kind: z.literal("RANGE"), from: z.string(), to: z.string() }),
  z.object({ kind: z.literal("WEEK"), anyDateInWeek: z.string() }),
  z.object({ kind: z.literal("PERIOD") }),
]);

/** Every write carries the revision the caller saw, so a stale tab gets CONFLICT. */
const scheduleRef = {
  scheduleId: z.uuid(),
  expectedRevision: z.number().int().nonnegative(),
};

export interface PreferenceWindowOutput {
  readonly revision: number;
  readonly windowIds: readonly string[];
}

/**
 * Opens preference collection (the INITIAL window). By default the whole
 * schedule period for the whole roster; a narrower date or nurse scope must lie
 * inside the period and the roster. The status change comes from the state
 * machine (`OPEN_PREFERENCES`: DRAFT → PLANNING), so opening twice is an
 * invalid transition, and the row lock plus `expectedRevision` make concurrent
 * attempts resolve to one success and one CONFLICT.
 */
export const openPreferenceWindow = defineCommand({
  name: "schedule.openPreferences",
  input: z.object({
    ...scheduleRef,
    scope: dateScopeInput.default({ kind: "PERIOD" }),
    /** Empty = everyone on the roster. */
    nurseIds: z.array(z.uuid()).max(500).default([]),
  }),
  async handler(uow, input): Promise<PreferenceWindowOutput> {
    const schedule = await loadScheduleForUpdate(uow, input.scheduleId);
    uow.authorize("schedule.openPreferences", {
      departmentId: schedule.departmentId,
    });
    // Checked after authorizing, so an outsider learns nothing from CONFLICT.
    if (schedule.revision !== input.expectedRevision) throw new ConflictError();

    const next = unwrap(
      transition(schedule.status, { type: "OPEN_PREFERENCES" }),
    );
    // Defensive: an INITIAL window exists only once per schedule.
    if ((await listPreferenceWindows(uow.tx, schedule.id)).length > 0)
      throw new ConflictError("Preference collection was already opened");

    const scope = unwrap(expandDateScope(input.scope, schedule.period));
    const roster = await listRoster(uow.tx, schedule.id);
    const nurseIds = unwrap(
      checkWindowNurses(input.nurseIds, new Set(roster.map((r) => r.userId))),
    );

    const saved = await saveSchedule(uow, schedule, { status: next });
    const windowId = await createPreferenceWindow(uow.tx, {
      scheduleId: schedule.id,
      kind: "INITIAL",
      scope,
      nurseIds,
      openedBy: uow.actor.userId,
      openedAt: uow.now,
    });

    const firstDate = scope.dates[0]!;
    const lastDate = scope.dates.at(-1)!;
    await uow.audit({
      action: "schedule.preferencesOpened",
      entityType: "preferenceWindow",
      entityId: windowId,
      departmentId: schedule.departmentId,
      scheduleId: schedule.id,
      data: {
        windowId,
        kind: "INITIAL",
        scopeKind: scope.kind,
        firstDate,
        lastDate,
        dateCount: scope.dates.length,
        nurseScope: nurseIds.length === 0 ? "ROSTER" : "SELECTED",
        nurseIds,
        from: schedule.status,
        to: next,
      },
    });

    // Nurses in scope learn that they can enter preferences (Phase 5 shows them).
    const recipients =
      nurseIds.length === 0 ? roster.map((r) => r.userId) : nurseIds;
    await uow.notify(
      recipients
        .filter((id) => id !== uow.actor.userId)
        .map((recipientId) => ({
          recipientId,
          type: "PREFERENCES_OPENED" as const,
          scheduleId: schedule.id,
          data: {
            windowId,
            label: schedule.label,
            firstDate,
            lastDate,
          },
        })),
    );

    return { revision: saved.revision, windowIds: [windowId] };
  },
});

/**
 * Closes (locks) preference collection: every window still open is closed, so
 * nurses can no longer edit. The status does not change (no state-machine
 * event exists for it); the revision is bumped so other tabs see the change.
 */
export const closePreferenceWindow = defineCommand({
  name: "schedule.closePreferences",
  input: z.object(scheduleRef),
  async handler(uow, input): Promise<PreferenceWindowOutput> {
    const schedule = await loadScheduleForUpdate(uow, input.scheduleId);
    uow.authorize("schedule.closePreferences", {
      departmentId: schedule.departmentId,
    });
    // Checked after authorizing, so an outsider learns nothing from CONFLICT.
    if (schedule.revision !== input.expectedRevision) throw new ConflictError();

    const windows = await listPreferenceWindows(uow.tx, schedule.id);
    if (countActiveWindows(windows, uow.now) === 0)
      throw new InvalidStateError(
        schedule.status,
        "CLOSE_PREFERENCES without an open preference window",
      );

    const windowIds = await closeOpenPreferenceWindowIds(uow.tx, {
      scheduleId: schedule.id,
      closedBy: uow.actor.userId,
      now: uow.now,
    });
    const saved = await saveSchedule(uow, schedule, {});

    await uow.audit({
      action: "schedule.preferencesClosed",
      entityType: "schedule",
      entityId: schedule.id,
      departmentId: schedule.departmentId,
      scheduleId: schedule.id,
      data: {
        windowIds,
        periodStart: schedule.period.start,
        periodEnd: schedule.period.end,
        status: schedule.status,
      },
    });

    return { revision: saved.revision, windowIds };
  },
});
