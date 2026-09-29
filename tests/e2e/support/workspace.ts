import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";

import { loadEnvConfig } from "@next/env";

import { hashPassword } from "../../../src/infrastructure/auth/password";
import { createDatabase } from "../../../src/infrastructure/db/database";
import { DEMO_PASSWORD } from "../../../src/infrastructure/db/seed/demo-data";
import { createDepartment } from "../../../src/infrastructure/repositories/departments";
import { addMembership } from "../../../src/infrastructure/repositories/memberships";
import { createUser } from "../../../src/infrastructure/repositories/users";
import { isoDate } from "../../../src/domain/shared/dates";

export interface E2eDepartment {
  readonly code: string;
  readonly name: string;
  readonly headEmail: string;
  readonly nurseEmail: string;
  /** Head Nurse + nurses, all members from 2026-01-01. */
  readonly memberCount: number;
}

let passwordHash: Promise<string> | undefined;

/**
 * A fresh department with its own Head Nurse and three nurses, so schedule
 * tests can create and change schedules without touching the shared demo data
 * or each other (tests run in parallel, per browser project, and on retry).
 * Uses the same database as the server under test (DATABASE_URL).
 */
export async function provisionDepartment(): Promise<E2eDepartment> {
  loadEnvConfig(process.cwd());
  if (!process.env.DATABASE_URL && existsSync(".env.local"))
    process.loadEnvFile(".env.local");
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required for schedule E2E tests");

  passwordHash ??= hashPassword(DEMO_PASSWORD);
  const suffix = randomUUID().slice(0, 8);
  const { db, pool } = createDatabase(url, { max: 1 });
  try {
    return await db.transaction(async (tx) => {
      const department = await createDepartment(tx, {
        code: `e2e-${suffix}`,
        name: `بخش آزمایشی ${suffix}`,
      });
      const people = [
        ["head", "HEAD_NURSE", "سرپرستار آزمایشی"],
        ["nurse1", "NURSE", "پرستار آزمایشی ۱"],
        ["nurse2", "NURSE", "پرستار آزمایشی ۲"],
        ["nurse3", "NURSE", "پرستار آزمایشی ۳"],
      ] as const;
      for (const [key, role, displayName] of people) {
        const user = await createUser(tx, {
          email: `${key}.${suffix}@e2e.invalid`,
          displayName,
          passwordHash: await passwordHash,
        });
        await addMembership(tx, {
          userId: user.id,
          departmentId: department.id,
          role,
          startedOn: isoDate("2026-01-01"),
        });
      }
      return {
        code: department.code,
        name: department.name,
        headEmail: `head.${suffix}@e2e.invalid`,
        nurseEmail: `nurse1.${suffix}@e2e.invalid`,
        memberCount: people.length,
      };
    });
  } finally {
    await pool.end();
  }
}
