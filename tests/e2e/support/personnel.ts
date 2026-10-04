import { randomUUID } from "node:crypto";

import { loadEnvConfig } from "@next/env";
import { eq } from "drizzle-orm";

import { addDays } from "../../../src/domain/shared/dates";
import { todayIn, APP_TIMEZONE } from "../../../src/infrastructure/auth/actor";
import { hashPassword } from "../../../src/infrastructure/auth/password";
import { createDatabase } from "../../../src/infrastructure/db/database";
import { DEMO_PASSWORD } from "../../../src/infrastructure/db/seed/demo-data";
import {
  supervisorAssignments,
  users,
} from "../../../src/infrastructure/db/schema";
import { createDepartment } from "../../../src/infrastructure/repositories/departments";
import { addMembership } from "../../../src/infrastructure/repositories/memberships";
import { createUser } from "../../../src/infrastructure/repositories/users";

let passwordHash: Promise<string> | undefined;

/** A unique, digits-only personnel number per fixture run and role. */
export function personnelNumberFor(suffix: string, key: string): string {
  const digits = BigInt(`0x${suffix}`).toString().padStart(10, "0");
  return `8${digits}${key.length}${key.charCodeAt(0) % 10}`;
}

/** Isolated local fixtures; never grants authority to shared demo/production accounts. */
export async function provisionPersonnel() {
  loadEnvConfig(process.cwd());
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required for personnel E2E tests");
  passwordHash ??= hashPassword(DEMO_PASSWORD);
  const { db, pool } = createDatabase(url, { max: 1 });
  try {
    return await db.transaction(async (tx) => {
      const suffix = randomUUID().slice(0, 8);
      const today = todayIn(APP_TIMEZONE);
      const own = await createDepartment(tx, {
        code: `people-${suffix}`,
        name: `بخش افراد ${suffix}`,
      });
      const other = await createDepartment(tx, {
        code: `other-${suffix}`,
        name: `بخش دیگر ${suffix}`,
      });
      // Every fixture account has an e-mail (the sign-in helpers use it).
      const people = {} as Record<
        "admin" | "head" | "supervisor" | "nurse" | "timeline" | "outsider",
        Awaited<ReturnType<typeof createUser>> & { email: string }
      >;
      for (const [key, label] of [
        ["admin", "مدیر"],
        ["head", "سرپرستار"],
        ["supervisor", "سوپروایزر"],
        ["nurse", "پرستار"],
        ["timeline", "تاریخچه"],
        ["outsider", "خارج بخش"],
      ] as const) {
        people[key] = (await createUser(tx, {
          personnelNumber: personnelNumberFor(suffix, key),
          email: `${key}.${suffix}@people-e2e.invalid`,
          displayName: `${label} ${suffix}`,
          passwordHash: await passwordHash,
          isActive: key !== "timeline",
        })) as Awaited<ReturnType<typeof createUser>> & { email: string };
      }
      // Test-fixture setup only. Production authority still uses the authenticated commands/bootstrap.
      await tx
        .update(users)
        .set({ isHospitalAdmin: true })
        .where(eq(users.id, people.admin.id));
      for (const key of ["head", "nurse"] as const)
        await addMembership(tx, {
          userId: people[key].id,
          departmentId: own.id,
          role: key === "head" ? "HEAD_NURSE" : "NURSE",
          startedOn: addDays(today, -100),
        });
      await addMembership(tx, {
        userId: people.outsider.id,
        departmentId: other.id,
        role: "NURSE",
        startedOn: addDays(today, -100),
      });
      await tx.insert(supervisorAssignments).values({
        userId: people.supervisor.id,
        departmentId: own.id,
        startedOn: addDays(today, -100),
      });
      for (const [start, end, role] of [
        [addDays(today, -100), addDays(today, -1), "NURSE"],
        [today, today, "HEAD_NURSE"],
        [addDays(today, 1), null, "NURSE"],
      ] as const) {
        await addMembership(tx, {
          userId: people.timeline.id,
          departmentId: own.id,
          role,
          startedOn: start,
          endedOn: end,
        });
        await tx.insert(supervisorAssignments).values({
          userId: people.timeline.id,
          departmentId: other.id,
          startedOn: start,
          endedOn: end,
        });
      }
      return { suffix, own, other, people, today };
    });
  } finally {
    await pool.end();
  }
}
