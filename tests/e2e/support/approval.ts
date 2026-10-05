import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";

import { loadEnvConfig } from "@next/env";

import {
  closePreferenceWindow,
  openPreferenceWindow,
} from "../../../src/application/schedules/preference-windows";
import {
  approveSchedule,
  finalizeSchedule,
  submitSchedule,
} from "../../../src/application/schedules/lifecycle";
import type { AppContext } from "../../../src/application/use-case";
import { isoDate } from "../../../src/domain/shared/dates";
import { hashPassword } from "../../../src/infrastructure/auth/password";
import { todayIn } from "../../../src/infrastructure/auth/actor";
import { createDatabase } from "../../../src/infrastructure/db/database";
import { DEMO_PASSWORD } from "../../../src/infrastructure/db/seed/demo-data";
import { setAssignment } from "../../../src/infrastructure/repositories/assignments";
import { findDepartmentByCode } from "../../../src/infrastructure/repositories/departments";
import {
  assignSupervisor,
  addMembership,
  loadActor,
} from "../../../src/infrastructure/repositories/memberships";
import { addToRoster } from "../../../src/infrastructure/repositories/roster";
import { findScheduleById } from "../../../src/infrastructure/repositories/schedules";
import {
  createUser,
  findUserByEmail,
} from "../../../src/infrastructure/repositories/users";
import { provisionReviewDepartment, type ReviewDepartment } from "./review";
import { completeScheduleFixture } from "../../support/complete-schedule";

export interface ApprovalDepartment extends ReviewDepartment {
  /** A Supervisor assigned to this department only (isolated per test). */
  readonly supervisorEmail: string;
}

function database() {
  loadEnvConfig(process.cwd());
  if (!process.env.DATABASE_URL && existsSync(".env.local"))
    process.loadEnvFile(".env.local");
  return createDatabase(process.env.DATABASE_URL!, { max: 1 });
}

/**
 * The review department (Aban with a night-rest finding on 4 Aban) plus its
 * own Supervisor, with Aban moved to PLANNING through the real use cases
 * (preference collection opened, then closed).
 *
 * `stage` goes further, also through the use cases: "finalized" fixes the
 * finding and finalizes, "submitted" also submits, "approved" also has the
 * department's Supervisor approve it.
 */
export async function provisionApprovalDepartment(
  stage: "planning" | "finalized" | "submitted" | "approved" = "planning",
): Promise<ApprovalDepartment> {
  const department = await provisionReviewDepartment();
  const { db, pool } = database();
  try {
    const supervisorEmail = `supervisor.${randomUUID().slice(0, 8)}@e2e.invalid`;
    const head = (await findUserByEmail(db, department.headEmail))!;
    const departmentId = (await findDepartmentByCode(db, department.code))!.id;
    const passwordHash = await hashPassword(DEMO_PASSWORD);
    const supervisor = await createUser(db, {
      email: supervisorEmail,
      displayName: "سوپروایزر آزمایشی",
      passwordHash,
    });
    await assignSupervisor(db, {
      userId: supervisor.id,
      departmentId,
      startedOn: isoDate("2026-01-01"),
    });

    // Every original nurse works on 24 Oct. A fifth roster member staffs the
    // previous Night without breaking the required next-day rest.
    const nightCover = await createUser(db, {
      email: department.nurseEmail.replace("nurse1.", "nurse4."),
      displayName: "پرستار پوشش شب آزمایشی",
      passwordHash,
    });
    await addMembership(db, {
      userId: nightCover.id,
      departmentId,
      role: "NURSE",
      startedOn: isoDate("2026-01-01"),
    });
    await addToRoster(db, {
      scheduleId: department.abanId,
      userId: nightCover.id,
      role: "NURSE",
      addedBy: head.id,
    });
    const actor = (await loadActor(db, head.id, todayIn("Asia/Tehran")))!;
    const ctx: AppContext = { db, actor };
    const step = async (
      command: (
        ctx: AppContext,
        input: unknown,
      ) => Promise<{ ok: boolean; error?: { message: string } }>,
      as: AppContext = ctx,
    ) => {
      const { revision } = (await findScheduleById(db, department.abanId))!;
      const result = await command(as, {
        scheduleId: department.abanId,
        expectedRevision: revision,
      });
      if (!result.ok) throw new Error(result.error?.message);
    };
    await step(openPreferenceWindow);
    await step(closePreferenceWindow);
    const nurse3 = (await findUserByEmail(
      db,
      department.nurseEmail.replace("nurse1.", "nurse3."),
    ))!;
    const nurse2 = (await findUserByEmail(
      db,
      department.nurseEmail.replace("nurse1.", "nurse2."),
    ))!;
    await completeScheduleFixture(db, department.abanId, [
      head.id,
      nurse3.id,
      nurse2.id,
      nightCover.id,
    ]);
    if (stage !== "planning") {
      // Explicit rest after the Night keeps every nurse-day decided.
      const nurse1 = (await findUserByEmail(db, department.nurseEmail))!;
      await setAssignment(db, {
        scheduleId: department.abanId,
        userId: nurse1.id,
        date: isoDate("2026-10-26"),
        shift: "OFF",
        updatedBy: head.id,
      });
      await step(finalizeSchedule);
    }
    if (stage === "submitted" || stage === "approved")
      await step(submitSchedule);
    if (stage === "approved") {
      const approver = (await loadActor(
        db,
        supervisor.id,
        todayIn("Asia/Tehran"),
      ))!;
      await step(approveSchedule, { db, actor: approver });
    }
    return {
      ...department,
      memberCount: department.memberCount + 1,
      supervisorEmail,
    };
  } finally {
    await pool.end();
  }
}
