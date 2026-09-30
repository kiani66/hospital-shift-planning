import { existsSync } from "node:fs";

import { loadEnvConfig } from "@next/env";

import { createSchedule } from "../../../src/application/schedules/create-schedule";
import { isoDate } from "../../../src/domain/shared/dates";
import type { ShiftCode } from "../../../src/domain/shifts/shift-type";
import { todayIn } from "../../../src/infrastructure/auth/actor";
import { createDatabase } from "../../../src/infrastructure/db/database";
import { setAssignment } from "../../../src/infrastructure/repositories/assignments";
import { loadActor } from "../../../src/infrastructure/repositories/memberships";
import { setPreference } from "../../../src/infrastructure/repositories/preferences";
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
 * editing, so assignments are written with the repository, as Phase 7b will.
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
