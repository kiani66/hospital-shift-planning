import { loadEnvConfig } from "@next/env";
import { createDatabase } from "../../../src/infrastructure/db/database";
import { findUserByEmail } from "../../../src/infrastructure/repositories/users";
import { setPreference } from "../../../src/infrastructure/repositories/preferences";
import { isoDate } from "../../../src/domain/shared/dates";
import { provisionApprovalDepartment } from "./approval";
import { setShift } from "./requests";

/** Fully staffed fixture with one genuinely undecided OFF preference. */
export async function provisionExplicitOffDepartment() {
  const department = await provisionApprovalDepartment("planning");
  await setShift(department, department.nurseEmail, "2026-10-26", "OFF");
  await setShift(department, department.nurseEmail, "2026-10-27", null);
  loadEnvConfig(process.cwd());
  const { db, pool } = createDatabase(process.env.DATABASE_URL!, { max: 1 });
  try {
    const nurse = (await findUserByEmail(db, department.nurseEmail))!;
    await setPreference(db, {
      scheduleId: department.abanId,
      userId: nurse.id,
      date: isoDate("2026-10-27"),
      value: "OFF",
    });
  } finally {
    await pool.end();
  }
  return department;
}
