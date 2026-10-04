import { existsSync } from "node:fs";

import { loadEnvConfig } from "@next/env";
import { eq } from "drizzle-orm";

import { createSchedule } from "../../../src/application/schedules/create-schedule";
import type { ScheduleStatus } from "../../../src/domain/schedule/status";
import { isoDate } from "../../../src/domain/shared/dates";
import type { ShiftCode } from "../../../src/domain/shifts/shift-type";
import { todayIn } from "../../../src/infrastructure/auth/actor";
import { createDatabase } from "../../../src/infrastructure/db/database";
import { users } from "../../../src/infrastructure/db/schema";
import { setAssignment } from "../../../src/infrastructure/repositories/assignments";
import { loadActor } from "../../../src/infrastructure/repositories/memberships";
import { setPreference } from "../../../src/infrastructure/repositories/preferences";
import {
  findScheduleById,
  updateSchedule,
} from "../../../src/infrastructure/repositories/schedules";
import { findUserByEmail } from "../../../src/infrastructure/repositories/users";
import { provisionDepartment, type E2eDepartment } from "./workspace";

/** Aban and Azar 1405: Aban needs six calendar rows, Azar five. */
export const ABAN = {
  start: "2026-10-23",
  end: "2026-11-21",
  label: "آبان ۱۴۰۵",
};
export const AZAR = {
  start: "2026-11-22",
  end: "2026-12-21",
  label: "آذر ۱۴۰۵",
};

export interface ReviewDepartment extends E2eDepartment {
  readonly abanId: string;
  readonly azarId: string;
  readonly nurseNames: readonly string[];
}

/**
 * A fresh department with Aban and Azar schedules (created through the real
 * use case) and a known set of Aban assignments. Phase 7a has no assignment
 * editing, so assignments are written with the repository (Phase 7b's use
 * case writes the same rows).
 *
 * - 2 Aban (2026-10-24): M, E, N, ME, all valid.
 * - 3 Aban (2026-10-25): nurse 1 works N.
 * - 4 Aban (2026-10-26): nurse 1 works M after that night → needs attention.
 * - every other day: unplanned.
 */
export async function provisionReviewDepartment(): Promise<ReviewDepartment> {
  const department = await provisionDepartment();
  loadEnvConfig(process.cwd());
  if (!process.env.DATABASE_URL && existsSync(".env.local"))
    process.loadEnvFile(".env.local");
  const { db, pool } = createDatabase(process.env.DATABASE_URL!, { max: 1 });
  try {
    const head = (await findUserByEmail(db, department.headEmail))!;
    const actor = (await loadActor(db, head.id, todayIn("Asia/Tehran")))!;
    const departmentId = actor.memberships[0]!.departmentId;
    const ids: string[] = [];
    for (const month of [ABAN, AZAR]) {
      const created = await createSchedule(
        { db, actor },
        {
          departmentId,
          periodStart: month.start,
          periodEnd: month.end,
          label: month.label,
        },
      );
      if (!created.ok) throw new Error(created.error.message);
      ids.push(created.data.scheduleId);
    }
    const nurse = async (n: number) =>
      (await findUserByEmail(
        db,
        department.nurseEmail.replace("nurse1.", `nurse${n}.`),
      ))!;
    const [n1, n2, n3] = [await nurse(1), await nurse(2), await nurse(3)];
    const assign = (userId: string, date: string, shift: ShiftCode) =>
      setAssignment(db, {
        scheduleId: ids[0]!,
        userId,
        date: isoDate(date),
        shift,
        updatedBy: head.id,
      });
    await assign(n1.id, "2026-10-24", "M");
    await assign(n2.id, "2026-10-24", "E");
    await assign(n3.id, "2026-10-24", "N");
    await assign(head.id, "2026-10-24", "ME");
    await assign(n1.id, "2026-10-25", "N");
    await assign(n1.id, "2026-10-26", "M");
    await setPreference(db, {
      scheduleId: ids[0]!,
      userId: n2.id,
      date: isoDate("2026-10-24"),
      value: "N",
    });
    return {
      ...department,
      abanId: ids[0]!,
      azarId: ids[1]!,
      nurseNames: [n1.displayName, n2.displayName, n3.displayName],
    };
  } finally {
    await pool.end();
  }
}

/**
 * Moves a schedule to a status the workflow (Phase 8) will reach, so tests
 * can check what editing does in it. Test-only: bypasses the state machine.
 */
export async function forceScheduleStatus(
  scheduleId: string,
  status: ScheduleStatus,
): Promise<void> {
  loadEnvConfig(process.cwd());
  if (!process.env.DATABASE_URL && existsSync(".env.local"))
    process.loadEnvFile(".env.local");
  const { db, pool } = createDatabase(process.env.DATABASE_URL!, { max: 1 });
  try {
    const schedule = (await findScheduleById(db, scheduleId))!;
    await updateSchedule(db, {
      id: scheduleId,
      expectedRevision: schedule.revision,
      status,
    });
  } finally {
    await pool.end();
  }
}

/** A nurse long enough to test that names never break the day editor's layout. */
export const LONG_NAME =
  "پرستار آزمایشی با نام و نام‌خانوادگی بسیار طولانی عبدالرحیم‌زاده‌اصفهانی‌نژادِ‌کرمانشاهی";

export interface AlignmentDepartment extends ReviewDepartment {
  /** Nurse 3 renamed to `LONG_NAME`. */
  readonly nurseNames: readonly [string, string, string];
}

/**
 * `provisionReviewDepartment` plus preferences for the preference-alignment
 * views (D99). Nurse 3 gets `LONG_NAME`.
 *
 * - 2 Aban (2026-10-24; M, E, N, ME assigned): nurse 1 wishes M (matches),
 *   nurse 2 wishes N (works E: conflict), nurse 3 wishes OFF (works N:
 *   conflict), the Head Nurse has no preference.
 * - 5 Aban (2026-10-27; unplanned): nurse 1 wishes OFF (rest honoured),
 *   nurse 2 wishes E (no shift yet); no conflict.
 * - 7 Aban (2026-10-29; unplanned): no preference at all.
 */
export async function provisionAlignmentDepartment(): Promise<AlignmentDepartment> {
  const department = await provisionReviewDepartment();
  const { db, pool } = createDatabase(process.env.DATABASE_URL!, { max: 1 });
  try {
    const nurse = async (n: number) =>
      (await findUserByEmail(
        db,
        department.nurseEmail.replace("nurse1.", `nurse${n}.`),
      ))!;
    const [n1, n2, n3] = [await nurse(1), await nurse(2), await nurse(3)];
    const prefer = (userId: string, date: string, value: ShiftCode | "OFF") =>
      setPreference(db, {
        scheduleId: department.abanId,
        userId,
        date: isoDate(date),
        value,
      });
    await prefer(n1.id, "2026-10-24", "M");
    await prefer(n3.id, "2026-10-24", "OFF");
    await prefer(n1.id, "2026-10-27", "OFF");
    await prefer(n2.id, "2026-10-27", "E");
    await db
      .update(users)
      .set({ displayName: LONG_NAME })
      .where(eq(users.id, n3.id));
    return {
      ...department,
      nurseNames: [n1.displayName, n2.displayName, LONG_NAME],
    };
  } finally {
    await pool.end();
  }
}
