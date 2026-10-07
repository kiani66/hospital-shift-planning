import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";

import { loadEnvConfig } from "@next/env";
import { eq } from "drizzle-orm";

import { hashPassword } from "../../../src/infrastructure/auth/password";
import { createDatabase } from "../../../src/infrastructure/db/database";
import { users } from "../../../src/infrastructure/db/schema";
import { DEMO_PASSWORD } from "../../../src/infrastructure/db/seed/demo-data";
import { createUser } from "../../../src/infrastructure/repositories/users";
import {
  provisionApprovalDepartment,
  type ApprovalDepartment,
} from "./approval";

export interface RulesDepartment extends ApprovalDepartment {
  /** An isolated Hospital Admin account for this test only. */
  readonly adminEmail: string;
}

/**
 * The approval department in PLANNING (Aban with known assignments and its
 * own Supervisor) plus a dedicated Hospital Admin. Test-fixture setup only:
 * production authority is granted through the audited commands/bootstrap.
 */
export async function provisionRulesDepartment(): Promise<RulesDepartment> {
  const department = await provisionApprovalDepartment("planning");
  loadEnvConfig(process.cwd());
  if (!process.env.DATABASE_URL && existsSync(".env.local"))
    process.loadEnvFile(".env.local");
  const { db, pool } = createDatabase(process.env.DATABASE_URL!, { max: 1 });
  try {
    const adminEmail = `admin.${randomUUID().slice(0, 8)}@rules-e2e.invalid`;
    const admin = await createUser(db, {
      email: adminEmail,
      displayName: "مدیر آزمایشی قوانین",
      passwordHash: await hashPassword(DEMO_PASSWORD),
    });
    await db
      .update(users)
      .set({ isHospitalAdmin: true })
      .where(eq(users.id, admin.id));
    return { ...department, adminEmail };
  } finally {
    await pool.end();
  }
}
