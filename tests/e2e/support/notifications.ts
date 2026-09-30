import { existsSync } from "node:fs";

import { loadEnvConfig } from "@next/env";
import { and, eq, isNull } from "drizzle-orm";

import { createSchedule } from "../../../src/application/schedules/create-schedule";
import { openPreferenceWindow } from "../../../src/application/schedules/preference-windows";
import { todayIn } from "../../../src/infrastructure/auth/actor";
import { createDatabase } from "../../../src/infrastructure/db/database";
import { notifications } from "../../../src/infrastructure/db/schema";
import { loadActor } from "../../../src/infrastructure/repositories/memberships";
import {
  findUserByEmail,
  setUserActive,
} from "../../../src/infrastructure/repositories/users";
import { provisionDepartment, type E2eDepartment } from "./workspace";

/** Whole Jalali months of 1405 (Mehr to Esfand), as ISO periods, for fresh schedules. */
const MONTHS = [
  { start: "2026-10-23", end: "2026-11-21", label: "آبان ۱۴۰۵" },
  { start: "2026-11-22", end: "2026-12-21", label: "آذر ۱۴۰۵" },
  { start: "2026-12-22", end: "2027-01-20", label: "دی ۱۴۰۵" },
  { start: "2027-01-21", end: "2027-02-19", label: "بهمن ۱۴۰۵" },
] as const;

function databaseUrl(): string {
  loadEnvConfig(process.cwd());
  if (!process.env.DATABASE_URL && existsSync(".env.local"))
    process.loadEnvFile(".env.local");
  const url = process.env.DATABASE_URL;
  if (!url)
    throw new Error("DATABASE_URL is required for notification E2E tests");
  return url;
}

async function withDb<T>(
  run: (db: ReturnType<typeof createDatabase>["db"]) => Promise<T>,
): Promise<T> {
  const { db, pool } = createDatabase(databaseUrl(), { max: 1 });
  try {
    return await run(db);
  } finally {
    await pool.end();
  }
}

export interface NotifiedDepartment extends E2eDepartment {
  readonly nurse2Email: string;
  /** Schedule labels, oldest period first; one notification per nurse each. */
  readonly labels: readonly string[];
}

/**
 * A fresh department whose Head Nurse created `count` monthly schedules and
 * opened preference collection on each, through the real Phase 4 use cases.
 * Every nurse therefore has `count` unread PREFERENCES_OPENED notifications
 * (the Head Nurse, who opened them, has none).
 */
export async function provisionNotifiedDepartment(
  count = 1,
): Promise<NotifiedDepartment> {
  const department = await provisionDepartment();
  const months = MONTHS.slice(0, count);
  await withDb(async (db) => {
    const head = (await findUserByEmail(db, department.headEmail))!;
    const actor = (await loadActor(db, head.id, todayIn("Asia/Tehran")))!;
    const ctx = { db, actor };
    for (const month of months) {
      const created = await createSchedule(ctx, {
        departmentId: actor.memberships[0]!.departmentId,
        periodStart: month.start,
        periodEnd: month.end,
        label: month.label,
      });
      if (!created.ok) throw new Error(created.error.message);
      const opened = await openPreferenceWindow(ctx, {
        scheduleId: created.data.scheduleId,
        expectedRevision: created.data.revision,
      });
      if (!opened.ok) throw new Error(opened.error.message);
    }
  });
  return {
    ...department,
    nurse2Email: department.nurseEmail.replace("nurse1.", "nurse2."),
    labels: months.map((m) => m.label),
  };
}

/** The user's notifications (newest first) with their read state, straight from the database. */
export async function notificationsOf(email: string) {
  return withDb(async (db) => {
    const user = (await findUserByEmail(db, email))!;
    const rows = await db
      .select({ id: notifications.id, readAt: notifications.readAt })
      .from(notifications)
      .where(eq(notifications.recipientId, user.id));
    return rows;
  });
}

export async function unreadCountOf(email: string): Promise<number> {
  return withDb(async (db) => {
    const user = (await findUserByEmail(db, email))!;
    const rows = await db
      .select({ id: notifications.id })
      .from(notifications)
      .where(
        and(
          eq(notifications.recipientId, user.id),
          isNull(notifications.readAt),
        ),
      );
    return rows.length;
  });
}

export async function deactivate(email: string): Promise<void> {
  await withDb(async (db) => {
    const user = (await findUserByEmail(db, email))!;
    await setUserActive(db, user.id, false);
  });
}
