import { loadEnvConfig } from "@next/env";
import { isoDate } from "../../../src/domain/shared/dates";
import { createDatabase } from "../../../src/infrastructure/db/database";
import {
  setAssignment,
  listAssignments,
} from "../../../src/infrastructure/repositories/assignments";
import { setPreference } from "../../../src/infrastructure/repositories/preferences";
import { findUserByEmail } from "../../../src/infrastructure/repositories/users";
import { provisionReviewDepartment, type ReviewDepartment } from "./review";

export async function provisionMonthlyPreferences() {
  const d = await provisionReviewDepartment();
  loadEnvConfig(process.cwd());
  const { db, pool } = createDatabase(process.env.DATABASE_URL!, { max: 1 });
  try {
    const head = (await findUserByEmail(db, d.headEmail))!;
    const nurse1 = (await findUserByEmail(db, d.nurseEmail))!;
    const nurse3 = (await findUserByEmail(
      db,
      d.nurseEmail.replace("nurse1.", "nurse3."),
    ))!;
    await setAssignment(db, {
      scheduleId: d.abanId,
      userId: nurse3.id,
      date: isoDate("2026-10-24"),
      shift: "H",
      updatedBy: head.id,
    });
    for (const [userId, value] of [
      [nurse1.id, "ME"],
      [nurse3.id, "OFF"],
    ] as const)
      await setPreference(db, {
        scheduleId: d.abanId,
        userId,
        date: isoDate("2026-10-24"),
        value,
      });
    return d;
  } finally {
    await pool.end();
  }
}

export async function monthlyPreferenceCells(d: ReviewDepartment) {
  loadEnvConfig(process.cwd());
  const { db, pool } = createDatabase(process.env.DATABASE_URL!, { max: 1 });
  try {
    return await listAssignments(db, d.abanId);
  } finally {
    await pool.end();
  }
}

export async function updateMonthlyPreference(d: ReviewDepartment) {
  loadEnvConfig(process.cwd());
  const { db, pool } = createDatabase(process.env.DATABASE_URL!, { max: 1 });
  try {
    const nurse = (await findUserByEmail(
      db,
      d.nurseEmail.replace("nurse1.", "nurse2."),
    ))!;
    await setPreference(db, {
      scheduleId: d.abanId,
      userId: nurse.id,
      date: isoDate("2026-10-24"),
      value: "OFF",
    });
  } finally {
    await pool.end();
  }
}
