import { randomUUID } from "node:crypto";

import { loadEnvConfig } from "@next/env";

import { isoDate } from "../../../src/domain/shared/dates";
import { hashPassword } from "../../../src/infrastructure/auth/password";
import { createDatabase } from "../../../src/infrastructure/db/database";
import { DEMO_PASSWORD } from "../../../src/infrastructure/db/seed/demo-data";
import { setAssignment } from "../../../src/infrastructure/repositories/assignments";
import { createDepartment } from "../../../src/infrastructure/repositories/departments";
import { addMembership } from "../../../src/infrastructure/repositories/memberships";
import { snapshotRosterFromMemberships } from "../../../src/infrastructure/repositories/roster";
import { createSchedule } from "../../../src/infrastructure/repositories/schedules";
import {
  createUser,
  type UserRecord,
} from "../../../src/infrastructure/repositories/users";
import { syntheticTemplate } from "../../support/excel-templates";
import { NICU_SECRETARY_ROW, nicuTemplate } from "../../support/nicu-template";

/** Mehr 1405: 30 days. */
export const MEHR_1405 = { start: "2026-09-23", end: "2026-10-22" } as const;

/**
 * An isolated fictional department with a Head Nurse, a nurse and a
 * secretary, a DRAFT Mehr 1405 schedule planned for its first days only, and
 * a synthetic print-layout template naming them in another order.
 */
export async function provisionExcelExport() {
  loadEnvConfig(process.cwd());
  const { db, pool } = createDatabase(process.env.DATABASE_URL!, { max: 1 });
  try {
    const suffix = randomUUID().slice(0, 8);
    const department = await createDepartment(db, {
      code: `xl-${suffix}`,
      name: `بخش نمونه قالب ${suffix}`,
    });
    const passwordHash = await hashPassword(DEMO_PASSWORD);
    const base = BigInt(`0x${suffix}`).toString().slice(0, 9);
    const people: UserRecord[] = [];
    for (const [key, role, name] of [
      ["head", "HEAD_NURSE", "سرپرستار نمونه"],
      ["nurse", "NURSE", "پرستار نمونه"],
      ["secretary", "SECRETARY", "منشی نمونه"],
    ] as const) {
      const person = await createUser(db, {
        email: `${key}.${suffix}@excel-export-e2e.invalid`,
        // A leading zero proves numbers are matched as text.
        personnelNumber: `0${base}${people.length}`,
        displayName: `${name} ${suffix}`,
        passwordHash,
      });
      await addMembership(db, {
        departmentId: department.id,
        userId: person.id,
        role,
        startedOn: isoDate("2026-01-01"),
      });
      people.push(person);
    }
    const [head, nurse, secretary] = people as [
      UserRecord,
      UserRecord,
      UserRecord,
    ];
    const schedule = await createSchedule(db, {
      departmentId: department.id,
      period: { start: isoDate(MEHR_1405.start), end: isoDate(MEHR_1405.end) },
      label: "مهر ۱۴۰۵",
      createdBy: head.id,
    });
    await snapshotRosterFromMemberships(db, {
      scheduleId: schedule.id,
      addedBy: head.id,
    });
    const decide = (
      userId: string,
      date: string,
      shift: "M" | "N" | "OFF" | "H",
    ) =>
      setAssignment(db, {
        scheduleId: schedule.id,
        userId,
        date: isoDate(date),
        shift,
        updatedBy: head.id,
      });
    await decide(nurse.id, "2026-09-23", "N");
    await decide(nurse.id, "2026-09-24", "OFF");
    await decide(secretary.id, "2026-09-23", "M");
    await decide(secretary.id, "2026-09-25", "H");
    const template = (order: readonly UserRecord[]) =>
      syntheticTemplate({
        people: order.map((p, i) => ({
          row: 7 + i * 2,
          number: p.personnelNumber!,
          name: p.displayName,
        })),
      });
    return {
      department,
      schedule,
      head,
      nurse,
      secretary,
      template: Buffer.from(await template([secretary, nurse, head])),
      replacement: Buffer.from(await template([nurse, head, secretary])),
      /** The sanitized NICU workbook: the people's recorded numbers printed in B. */
      nicu: Buffer.from(
        await nicuTemplate({
          peopleRows: [7, 8, NICU_SECRETARY_ROW],
          numbers: new Map([
            [7, head.personnelNumber!],
            [8, nurse.personnelNumber!],
            [NICU_SECRETARY_ROW, secretary.personnelNumber!],
          ]),
        }),
      ),
    };
  } finally {
    await pool.end();
  }
}
