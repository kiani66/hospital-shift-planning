import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";

import { loadEnvConfig } from "@next/env";

import {
  closePreferenceWindow,
  openPreferenceWindow,
} from "../../../src/application/schedules/preference-windows";
import {
  finalizeSchedule,
  submitSchedule,
} from "../../../src/application/schedules/lifecycle";
import type { AppContext } from "../../../src/application/use-case";
import { isoDate } from "../../../src/domain/shared/dates";
import { hashPassword } from "../../../src/infrastructure/auth/password";
import { todayIn } from "../../../src/infrastructure/auth/actor";
import { createDatabase } from "../../../src/infrastructure/db/database";
import { DEMO_PASSWORD } from "../../../src/infrastructure/db/seed/demo-data";
import { clearAssignment } from "../../../src/infrastructure/repositories/assignments";
import { findDepartmentByCode } from "../../../src/infrastructure/repositories/departments";
import {
  assignSupervisor,
  loadActor,
} from "../../../src/infrastructure/repositories/memberships";
import { findScheduleById } from "../../../src/infrastructure/repositories/schedules";
import {
  createUser,
  findUserByEmail,
} from "../../../src/infrastructure/repositories/users";
import { provisionReviewDepartment, type ReviewDepartment } from "./review";

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
 * finding and finalizes, "submitted" also submits.
 */
export async function provisionApprovalDepartment(
  stage: "planning" | "finalized" | "submitted" = "planning",
): Promise<ApprovalDepartment> {
  const department = await provisionReviewDepartment();
  const { db, pool } = database();
  try {
    const supervisorEmail = `supervisor.${randomUUID().slice(0, 8)}@e2e.invalid`;
    const head = (await findUserByEmail(db, department.headEmail))!;
    const departmentId = (await findDepartmentByCode(db, department.code))!.id;
    const supervisor = await createUser(db, {
      email: supervisorEmail,
      displayName: "سوپروایزر آزمایشی",
      passwordHash: await hashPassword(DEMO_PASSWORD),
    });
    await assignSupervisor(db, {
      userId: supervisor.id,
      departmentId,
      startedOn: isoDate("2026-01-01"),
    });

    const actor = (await loadActor(db, head.id, todayIn("Asia/Tehran")))!;
    const ctx: AppContext = { db, actor };
    const step = async (
      command: (
        ctx: AppContext,
        input: unknown,
      ) => Promise<{ ok: boolean; error?: { message: string } }>,
    ) => {
      const { revision } = (await findScheduleById(db, department.abanId))!;
      const result = await command(ctx, {
        scheduleId: department.abanId,
        expectedRevision: revision,
      });
      if (!result.ok) throw new Error(result.error?.message);
    };
    await step(openPreferenceWindow);
    await step(closePreferenceWindow);
    if (stage !== "planning") {
      // Clear the Morning after the Night (4 Aban) so nothing blocks.
      const nurse1 = (await findUserByEmail(db, department.nurseEmail))!;
      await clearAssignment(db, {
        scheduleId: department.abanId,
        userId: nurse1.id,
        date: isoDate("2026-10-26"),
      });
      await step(finalizeSchedule);
    }
    if (stage === "submitted") await step(submitSchedule);
    return { ...department, supervisorEmail };
  } finally {
    await pool.end();
  }
}
