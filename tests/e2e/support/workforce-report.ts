import { randomUUID } from "node:crypto";

import { loadEnvConfig } from "@next/env";

import { addDays, isoDate } from "../../../src/domain/shared/dates";
import {
  jalaliMonthParam,
  jalaliMonthPeriod,
  nextJalaliMonth,
  toJalali,
} from "../../../src/features/calendar/jalali";
import { todayIn } from "../../../src/infrastructure/auth/actor";
import { hashPassword } from "../../../src/infrastructure/auth/password";
import { createDatabase } from "../../../src/infrastructure/db/database";
import { DEMO_PASSWORD } from "../../../src/infrastructure/db/seed/demo-data";
import { setAssignment } from "../../../src/infrastructure/repositories/assignments";
import { createDepartment } from "../../../src/infrastructure/repositories/departments";
import { addMembership } from "../../../src/infrastructure/repositories/memberships";
import { startRevision } from "../../../src/infrastructure/repositories/revisions";
import { snapshotRosterFromMemberships } from "../../../src/infrastructure/repositories/roster";
import {
  createSchedule,
  updateSchedule,
} from "../../../src/infrastructure/repositories/schedules";
import { createSubmission } from "../../../src/infrastructure/repositories/submissions";
import {
  createUser,
  setUserActive,
} from "../../../src/infrastructure/repositories/users";
import { createVersionFromWorkingCopy } from "../../../src/infrastructure/repositories/versions";

/** Fictional, isolated department. Writes only to the explicitly local E2E database. */
export async function provisionWorkforceReport(
  options: { approved?: boolean; multiple?: boolean; empty?: boolean } = {},
) {
  loadEnvConfig(process.cwd());
  const { db, pool } = createDatabase(process.env.DATABASE_URL!, { max: 1 });
  try {
    const suffix = randomUUID().slice(0, 8);
    const department = await createDepartment(db, {
      code: `wf-${suffix}`,
      name: `بخش گزارش آزمایشی ${suffix}`,
    });
    const passwordHash = await hashPassword(DEMO_PASSWORD);
    const base = BigInt(`0x${suffix}`).toString().padStart(10, "0");
    const people = [];
    for (const [key, role, displayName] of [
      ["head", "HEAD_NURSE", "کیانا سرپرستار"],
      ["nurse", "NURSE", "سارا پرستار"],
      ["secretary", "SECRETARY", "زهرا منشی"],
      ["inactive", "NURSE", "مریم غیرفعال"],
    ] as const) {
      const email = `${key}.${suffix}@workforce-e2e.invalid`;
      const person = await createUser(db, {
        email,
        displayName,
        personnelNumber: `0${base}${people.length}`,
        passwordHash,
        isActive: true,
      });
      await addMembership(db, {
        departmentId: department.id,
        userId: person.id,
        role,
        startedOn: isoDate("2020-01-01"),
      });
      people.push({ ...person, email });
    }
    const [head, nurse, secretary, inactive] = people as [
      (typeof people)[number],
      (typeof people)[number],
      (typeof people)[number],
      (typeof people)[number],
    ];
    const month = toJalali(todayIn("Asia/Tehran"));
    const period = jalaliMonthPeriod(month);
    const schedule = await createSchedule(db, {
      departmentId: department.id,
      period: { start: period.start, end: addDays(period.start, 4) },
      label: "برنامه پنج‌روزه",
      createdBy: head.id,
    });
    await snapshotRosterFromMemberships(db, {
      scheduleId: schedule.id,
      addedBy: head.id,
    });
    const assign = (
      userId: string,
      offset: number,
      shift: "M" | "E" | "N" | "ME" | "OFF" | "H",
    ) =>
      setAssignment(db, {
        scheduleId: schedule.id,
        userId,
        date: addDays(period.start, offset),
        shift,
        updatedBy: head.id,
      });
    if (!options.empty) {
      await assign(nurse.id, 0, "M");
      await assign(nurse.id, 1, "OFF");
      await assign(nurse.id, 2, "H");
      await assign(nurse.id, 4, "N");
      await assign(head.id, 0, "ME");
      await assign(secretary.id, 0, "E");
    }
    if (options.approved) {
      // Build distinct repository fixtures; workflow behavior is covered by the
      // Stage 2 integration suite. Nothing in the UI writes these records.
      const submission = await createSubmission(db, {
        scheduleId: schedule.id,
        submittedBy: head.id,
      });
      const version = await createVersionFromWorkingCopy(db, {
        scheduleId: schedule.id,
        submissionId: submission.id,
        approvedBy: head.id,
      });
      await updateSchedule(db, {
        id: schedule.id,
        expectedRevision: 0,
        status: "REVISING",
        currentVersionId: version.id,
      });
      await startRevision(db, {
        scheduleId: schedule.id,
        reason: "fixture revision",
        startedBy: head.id,
        dates: [period.start, addDays(period.start, 3)],
      });
      await assign(nurse.id, 0, "E");
      await assign(nurse.id, 3, "ME");
    }
    const second = options.multiple
      ? await createSchedule(db, {
          departmentId: department.id,
          period: {
            start: addDays(period.start, 10),
            end: addDays(period.start, 12),
          },
          label: "برنامه دوم",
          createdBy: head.id,
        })
      : null;
    const nextMonth = nextJalaliMonth(month);
    const emptyPeriod = jalaliMonthPeriod(nextMonth);
    const emptySchedule = await createSchedule(db, {
      departmentId: department.id,
      period: { start: emptyPeriod.start, end: addDays(emptyPeriod.start, 2) },
      label: "برنامه بدون تصمیم",
      createdBy: head.id,
    });
    await snapshotRosterFromMemberships(db, {
      scheduleId: emptySchedule.id,
      addedBy: head.id,
    });
    await setUserActive(db, inactive.id, false);
    return {
      department,
      schedule,
      second,
      head,
      nurse,
      secretary,
      inactive,
      month: jalaliMonthParam(month),
      nextMonth: jalaliMonthParam(nextMonth),
      emptySchedule,
    };
  } finally {
    await pool.end();
  }
}
