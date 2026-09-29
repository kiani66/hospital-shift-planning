import { and, asc, eq, inArray, isNull } from "drizzle-orm";

import type { PreferenceWindow } from "../../domain/preferences/preference-window";
import type { DateScope, DateScopeKind } from "../../domain/scope/date-scope";
import type { IsoDate } from "../../domain/shared/dates";
import type { DbExecutor } from "../db/database";
import {
  preferenceWindowDates,
  preferenceWindowNurses,
  preferenceWindows,
} from "../db/schema";
import { asIsoDate } from "./mappers";

export interface PreferenceWindowRecord extends PreferenceWindow {
  readonly id: string;
  readonly scopeKind: DateScopeKind;
  readonly reason: string | null;
}

export async function createPreferenceWindow(
  db: DbExecutor,
  input: {
    scheduleId: string;
    kind: PreferenceWindow["kind"];
    scope: DateScope;
    /** Empty = whole roster. */
    nurseIds?: readonly string[];
    reason?: string;
    closesAt?: Date | null;
    openedBy: string;
  },
): Promise<string> {
  const [window] = await db
    .insert(preferenceWindows)
    .values({
      scheduleId: input.scheduleId,
      kind: input.kind,
      scopeKind: input.scope.kind,
      reason: input.reason,
      closesAt: input.closesAt ?? null,
      openedBy: input.openedBy,
    })
    .returning({ id: preferenceWindows.id });
  const windowId = window!.id;
  await db
    .insert(preferenceWindowDates)
    .values(input.scope.dates.map((date) => ({ windowId, date })));
  if (input.nurseIds?.length) {
    await db
      .insert(preferenceWindowNurses)
      .values(input.nurseIds.map((userId) => ({ windowId, userId })));
  }
  return windowId;
}

/** All windows of a schedule (open and closed), as domain windows. */
export async function listPreferenceWindows(
  db: DbExecutor,
  scheduleId: string,
): Promise<PreferenceWindowRecord[]> {
  const windows = await db
    .select()
    .from(preferenceWindows)
    .where(eq(preferenceWindows.scheduleId, scheduleId))
    .orderBy(asc(preferenceWindows.openedAt));
  if (windows.length === 0) return [];

  const ids = windows.map((w) => w.id);
  const [dates, nurses] = await Promise.all([
    db
      .select()
      .from(preferenceWindowDates)
      .where(inArray(preferenceWindowDates.windowId, ids)),
    db
      .select()
      .from(preferenceWindowNurses)
      .where(inArray(preferenceWindowNurses.windowId, ids)),
  ]);

  return windows.map((w) => ({
    id: w.id,
    kind: w.kind,
    scopeKind: w.scopeKind,
    reason: w.reason,
    dates: new Set<IsoDate>(
      dates.filter((d) => d.windowId === w.id).map((d) => asIsoDate(d.date)),
    ),
    nurseIds: new Set(
      nurses.filter((n) => n.windowId === w.id).map((n) => n.userId),
    ),
    closesAt: w.closesAt,
    closedAt: w.closedAt,
  }));
}

/** Closes every not-yet-closed window (e.g. on FINALIZE). Returns how many. */
export async function closeOpenPreferenceWindows(
  db: DbExecutor,
  input: { scheduleId: string; closedBy: string; now: Date },
): Promise<number> {
  const rows = await db
    .update(preferenceWindows)
    .set({ closedBy: input.closedBy, closedAt: input.now })
    .where(
      and(
        eq(preferenceWindows.scheduleId, input.scheduleId),
        isNull(preferenceWindows.closedAt),
      ),
    )
    .returning({ id: preferenceWindows.id });
  return rows.length;
}
