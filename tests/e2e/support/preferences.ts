import { existsSync } from "node:fs";

import { loadEnvConfig } from "@next/env";
import { asc, eq } from "drizzle-orm";

import { closePreferenceWindow } from "../../../src/application/schedules/preference-windows";
import { todayIn } from "../../../src/infrastructure/auth/actor";
import { createDatabase } from "../../../src/infrastructure/db/database";
import {
  nursePreferences,
  schedules,
} from "../../../src/infrastructure/db/schema";
import { loadActor } from "../../../src/infrastructure/repositories/memberships";
import { findUserByEmail } from "../../../src/infrastructure/repositories/users";
import type { NotifiedDepartment } from "./notifications";

async function withDb<T>(
  run: (db: ReturnType<typeof createDatabase>["db"]) => Promise<T>,
): Promise<T> {
  loadEnvConfig(process.cwd());
  if (!process.env.DATABASE_URL && existsSync(".env.local"))
    process.loadEnvFile(".env.local");
  const url = process.env.DATABASE_URL;
  if (!url)
    throw new Error("DATABASE_URL is required for preference E2E tests");
  const { db, pool } = createDatabase(url, { max: 1 });
  try {
    return await run(db);
  } finally {
    await pool.end();
  }
}

/** The department's schedules, oldest period first (ids and revisions). */
export async function schedulesOf(department: NotifiedDepartment) {
  return withDb(async (db) => {
    const head = (await findUserByEmail(db, department.headEmail))!;
    const actor = (await loadActor(db, head.id, todayIn("Asia/Tehran")))!;
    return db
      .select({ id: schedules.id, revision: schedules.revision })
      .from(schedules)
      .where(eq(schedules.departmentId, actor.memberships[0]!.departmentId))
      .orderBy(asc(schedules.periodStart));
  });
}

/** The Head Nurse closes preference collection, through the real use case. */
export async function closePreferences(
  department: NotifiedDepartment,
  scheduleIndex = 0,
): Promise<void> {
  const schedule = (await schedulesOf(department))[scheduleIndex]!;
  await withDb(async (db) => {
    const head = (await findUserByEmail(db, department.headEmail))!;
    const actor = (await loadActor(db, head.id, todayIn("Asia/Tehran")))!;
    const result = await closePreferenceWindow(
      { db, actor },
      { scheduleId: schedule.id, expectedRevision: schedule.revision },
    );
    if (!result.ok) throw new Error(result.error.message);
  });
}

/** A user's stored preferences (date → value), straight from the database. */
export async function storedPreferencesOf(
  email: string,
): Promise<Record<string, string>> {
  return withDb(async (db) => {
    const user = (await findUserByEmail(db, email))!;
    const rows = await db
      .select({ date: nursePreferences.date, value: nursePreferences.value })
      .from(nursePreferences)
      .where(eq(nursePreferences.userId, user.id))
      .orderBy(asc(nursePreferences.date));
    return Object.fromEntries(rows.map((r) => [r.date, r.value]));
  });
}

export async function userIdOf(email: string): Promise<string> {
  return withDb(async (db) => (await findUserByEmail(db, email))!.id);
}
