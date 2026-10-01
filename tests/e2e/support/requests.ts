import { existsSync } from "node:fs";

import { loadEnvConfig } from "@next/env";

import {
  createChangeRequest,
  respondToSwapRequest,
} from "../../../src/application/change-requests/commands";
import { approveSchedule } from "../../../src/application/schedules/lifecycle";
import { isoDate } from "../../../src/domain/shared/dates";
import type { ShiftCode } from "../../../src/domain/shifts/shift-type";
import { todayIn } from "../../../src/infrastructure/auth/actor";
import { createDatabase } from "../../../src/infrastructure/db/database";
import {
  clearAssignment,
  listAssignments,
  setAssignment,
} from "../../../src/infrastructure/repositories/assignments";
import { loadActor } from "../../../src/infrastructure/repositories/memberships";
import { findScheduleById } from "../../../src/infrastructure/repositories/schedules";
import { findUserByEmail } from "../../../src/infrastructure/repositories/users";
import { listVersionAssignments } from "../../../src/infrastructure/repositories/versions";
import type { ApprovalDepartment } from "./approval";

/**
 * Setup steps for the Head Nurse request E2E tests, through the real use
 * cases (or, to change a shift "underneath" a request, the repository the
 * editor writes through). Same database as the server under test.
 */

async function withDb<T>(
  run: (db: ReturnType<typeof createDatabase>["db"]) => Promise<T>,
): Promise<T> {
  loadEnvConfig(process.cwd());
  if (!process.env.DATABASE_URL && existsSync(".env.local"))
    process.loadEnvFile(".env.local");
  const { db, pool } = createDatabase(process.env.DATABASE_URL!, { max: 1 });
  try {
    return await run(db);
  } finally {
    await pool.end();
  }
}

export const nurseEmail = (d: ApprovalDepartment, n: number) =>
  d.nurseEmail.replace("nurse1.", `nurse${n}.`);

async function contextOf(
  db: ReturnType<typeof createDatabase>["db"],
  email: string,
) {
  const user = (await findUserByEmail(db, email))!;
  const actor = (await loadActor(db, user.id, todayIn("Asia/Tehran")))!;
  return { db, actor };
}

/** A nurse's request on the department's Aban schedule; returns its id. */
export async function createRequestAs(
  department: ApprovalDepartment,
  email: string,
  input: {
    type: "UNAVAILABLE" | "CHANGE_SHIFT" | "SWAP" | "OTHER";
    date: string;
    targetShift?: ShiftCode;
    counterpartEmail?: string;
    reasonCode?: string;
    note?: string;
  },
): Promise<string> {
  return withDb(async (db) => {
    const counterpart = input.counterpartEmail
      ? (await findUserByEmail(db, input.counterpartEmail))!.id
      : undefined;
    const result = await createChangeRequest(await contextOf(db, email), {
      scheduleId: department.abanId,
      type: input.type,
      date: input.date,
      targetShift: input.targetShift,
      counterpartId: counterpart,
      reasonCode: input.reasonCode ?? "ILLNESS",
      note: input.note,
    });
    if (!result.ok) throw new Error(result.error.message);
    return result.data.id;
  });
}

export async function consentAs(email: string, requestId: string) {
  await withDb(async (db) => {
    const result = await respondToSwapRequest(await contextOf(db, email), {
      requestId,
      accept: true,
    });
    if (!result.ok) throw new Error(result.error.message);
  });
}

/** Changes a nurse's working-copy shift directly (as the editor would). */
export async function setShift(
  department: ApprovalDepartment,
  email: string,
  date: string,
  shift: ShiftCode | null,
) {
  await withDb(async (db) => {
    const user = (await findUserByEmail(db, email))!;
    const head = (await findUserByEmail(db, department.headEmail))!;
    const cell = {
      scheduleId: department.abanId,
      userId: user.id,
      date: isoDate(date),
    };
    if (shift === null) await clearAssignment(db, cell);
    else await setAssignment(db, { ...cell, shift, updatedBy: head.id });
  });
}

/** The Supervisor approves the submitted Aban schedule. */
export async function approveAban(department: ApprovalDepartment) {
  await withDb(async (db) => {
    const schedule = (await findScheduleById(db, department.abanId))!;
    const result = await approveSchedule(
      await contextOf(db, department.supervisorEmail),
      { scheduleId: schedule.id, expectedRevision: schedule.revision },
    );
    if (!result.ok) throw new Error(result.error.message);
  });
}

/** The Aban schedule's status, working-copy shift of a nurse, and approved cells. */
export async function abanState(
  department: ApprovalDepartment,
  email: string,
  date: string,
) {
  return withDb(async (db) => {
    const user = (await findUserByEmail(db, email))!;
    const schedule = (await findScheduleById(db, department.abanId))!;
    const cells = await listAssignments(db, schedule.id);
    const approved = schedule.currentVersionId
      ? await listVersionAssignments(db, schedule.currentVersionId)
      : [];
    const pick = (list: typeof cells) =>
      list.find((a) => a.nurseId === user.id && a.date === date)?.shift ?? null;
    return {
      status: schedule.status,
      shift: pick(cells),
      approvedShift: pick(approved),
    };
  });
}
