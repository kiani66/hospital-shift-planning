import { createSchedule } from "../../../src/application/schedules/create-schedule";
import { todayIn } from "../../../src/infrastructure/auth/actor";
import { loadActor } from "../../../src/infrastructure/repositories/memberships";
import { completeScheduleFixture } from "../../support/complete-schedule";
import { loadEnvConfig } from "@next/env";
import { isoDate } from "../../../src/domain/shared/dates";
import { createDatabase } from "../../../src/infrastructure/db/database";
import {
  clearAssignment,
  setAssignment,
  listAssignments,
} from "../../../src/infrastructure/repositories/assignments";
import { setPreference } from "../../../src/infrastructure/repositories/preferences";
import { findUserByEmail } from "../../../src/infrastructure/repositories/users";
import { provisionReviewDepartment, type ReviewDepartment } from "./review";

export async function provisionCopyDepartment() {
  const d = await provisionReviewDepartment();
  loadEnvConfig(process.cwd());
  const { db, pool } = createDatabase(process.env.DATABASE_URL!, { max: 1 });
  try {
    const n1 = (await findUserByEmail(db, d.nurseEmail))!;
    const n2 = (await findUserByEmail(
      db,
      d.nurseEmail.replace("nurse1.", "nurse2."),
    ))!;
    const head = (await findUserByEmail(db, d.headEmail))!;
    await setAssignment(db, {
      scheduleId: d.azarId,
      userId: n2.id,
      date: isoDate("2026-11-23"),
      shift: "H",
      updatedBy: head.id,
    });
    await setPreference(db, {
      scheduleId: d.azarId,
      userId: n1.id,
      date: isoDate("2026-11-23"),
      value: "OFF",
    });
    return d;
  } finally {
    await pool.end();
  }
}
export async function copyState(d: ReviewDepartment) {
  loadEnvConfig(process.cwd());
  const { db, pool } = createDatabase(process.env.DATABASE_URL!, { max: 1 });
  try {
    return {
      source: await listAssignments(db, d.abanId),
      target: await listAssignments(db, d.azarId),
    };
  } finally {
    await pool.end();
  }
}

/** Isolated Mehr → Aban: a complete source, one cross-month N→M pair. */
export async function provisionBoundaryCopyDepartment() {
  const d = await provisionReviewDepartment();
  loadEnvConfig(process.cwd());
  const { db, pool } = createDatabase(process.env.DATABASE_URL!, { max: 1 });
  try {
    const head = (await findUserByEmail(db, d.headEmail))!;
    const nurse = (await findUserByEmail(db, d.nurseEmail))!;
    const actor = (await loadActor(db, head.id, todayIn("Asia/Tehran")))!;
    const created = await createSchedule(
      { db, actor },
      {
        departmentId: actor.memberships[0]!.departmentId,
        periodStart: "2026-09-23",
        periodEnd: "2026-10-22",
        label: "مهر ۱۴۰۵",
      },
    );
    if (!created.ok) throw new Error(created.error.message);
    const mehrId = created.data.scheduleId;
    for (const a of await listAssignments(db, d.abanId))
      await clearAssignment(db, {
        scheduleId: d.abanId,
        userId: a.nurseId,
        date: a.date,
      });
    for (const [userId, date, shift] of [
      [nurse.id, "2026-09-23", "M"],
      [nurse.id, "2026-10-22", "N"],
      [head.id, "2026-10-22", "ME"],
    ] as const)
      await setAssignment(db, {
        scheduleId: mehrId,
        userId,
        date: isoDate(date),
        shift,
        updatedBy: head.id,
      });
    await completeScheduleFixture(db, mehrId, [head.id]);
    return { ...d, mehrId };
  } finally {
    await pool.end();
  }
}
