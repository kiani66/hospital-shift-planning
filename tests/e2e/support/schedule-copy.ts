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
