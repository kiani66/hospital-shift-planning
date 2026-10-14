import { randomUUID } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import ExcelJS from "exceljs";

import { createDatabase } from "../../../src/infrastructure/db/database";
import { hashPassword } from "../../../src/infrastructure/auth/password";
import { DEMO_PASSWORD } from "../../../src/infrastructure/db/seed/demo-data";
import { createDepartment } from "../../../src/infrastructure/repositories/departments";
import { addMembership } from "../../../src/infrastructure/repositories/memberships";
import { createUser } from "../../../src/infrastructure/repositories/users";
import { isoDate } from "../../../src/domain/shared/dates";

/** Isolated fictional identities; never touch real NICU accounts. */
export async function provisionScheduleImport() {
  loadEnvConfig(process.cwd());
  const { db, pool } = createDatabase(process.env.DATABASE_URL!, { max: 1 });
  try {
    const suffix = randomUUID().slice(0, 8);
    const department = await createDepartment(db, {
      code: `excel-${suffix}`,
      name: `بخش ورود اکسل ${suffix}`,
    });
    const passwordHash = await hashPassword(DEMO_PASSWORD);
    const people = [];
    for (const [key, role, name] of [
      ["head", "HEAD_NURSE", "سرپرستار نمونه"],
      ["nurse", "NURSE", "پرستار نمونه"],
      ["secretary", "SECRETARY", "منشی نمونه"],
    ] as const) {
      const person = await createUser(db, {
        email: `${key}.${suffix}@excel-e2e.invalid`,
        personnelNumber: `9${BigInt(`0x${suffix}`).toString()}${people.length}`,
        displayName: `${name} ${suffix}`,
        passwordHash,
      });
      await addMembership(db, {
        departmentId: department.id,
        userId: person.id,
        role,
        startedOn: isoDate("2026-01-01"),
      });
      people.push({ ...person, role });
    }
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("برنامه ماهانه", {
      views: [{ rightToLeft: true }],
    });
    sheet.addRow([
      "شماره پرسنلی",
      "نام و نام خانوادگی",
      ...Array.from({ length: 30 }, (_, i) => i + 1),
    ]);
    for (const person of people)
      sheet.addRow([
        person.personnelNumber,
        person.displayName,
        "M",
        "E",
        "N",
        null,
        "ME",
        "H",
      ]);
    return {
      department,
      people,
      headEmail: people[0]!.email!,
      secretaryEmail: people[2]!.email!,
      bytes: Buffer.from(await workbook.xlsx.writeBuffer()),
    };
  } finally {
    await pool.end();
  }
}
