import { and, asc, eq } from "drizzle-orm";

import type { IsoDate } from "../../domain/shared/dates";
import type { PreferenceValue } from "../../domain/shifts/shift-type";
import type { DbExecutor } from "../db/database";
import { nursePreferences } from "../db/schema";
import { asIsoDate } from "./mappers";

export interface PreferenceRecord {
  readonly userId: string;
  readonly date: IsoDate;
  readonly value: PreferenceValue;
}

/** One preference per nurse per day: inserts or replaces it. */
export async function setPreference(
  db: DbExecutor,
  input: {
    scheduleId: string;
    userId: string;
    date: IsoDate;
    value: PreferenceValue;
  },
): Promise<void> {
  await db
    .insert(nursePreferences)
    .values(input)
    .onConflictDoUpdate({
      target: [
        nursePreferences.scheduleId,
        nursePreferences.userId,
        nursePreferences.date,
      ],
      set: { value: input.value, updatedAt: new Date() },
    });
}

export async function clearPreference(
  db: DbExecutor,
  input: { scheduleId: string; userId: string; date: IsoDate },
): Promise<boolean> {
  const rows = await db
    .delete(nursePreferences)
    .where(
      and(
        eq(nursePreferences.scheduleId, input.scheduleId),
        eq(nursePreferences.userId, input.userId),
        eq(nursePreferences.date, input.date),
      ),
    )
    .returning({ date: nursePreferences.date });
  return rows.length > 0;
}

export async function listPreferences(
  db: DbExecutor,
  scheduleId: string,
  filter: { userId?: string } = {},
): Promise<PreferenceRecord[]> {
  const rows = await db
    .select({
      userId: nursePreferences.userId,
      date: nursePreferences.date,
      value: nursePreferences.value,
    })
    .from(nursePreferences)
    .where(
      and(
        eq(nursePreferences.scheduleId, scheduleId),
        filter.userId ? eq(nursePreferences.userId, filter.userId) : undefined,
      ),
    )
    .orderBy(asc(nursePreferences.date), asc(nursePreferences.userId));
  return rows.map((r) => ({ ...r, date: asIsoDate(r.date) }));
}
