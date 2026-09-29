import { and, asc, eq, sql } from "drizzle-orm";

import type { DatePeriod } from "../../domain/shared/period";
import type { ScheduleStatus } from "../../domain/schedule/status";
import type { DbExecutor, Transaction } from "../db/database";
import { schedules } from "../db/schema";
import { asIsoDate } from "./mappers";

export interface ScheduleRecord {
  readonly id: string;
  readonly departmentId: string;
  readonly period: DatePeriod;
  readonly label: string;
  readonly status: ScheduleStatus;
  /** Optimistic-concurrency counter. */
  readonly revision: number;
  readonly currentVersionId: string | null;
  readonly createdBy: string;
}

const columns = {
  id: schedules.id,
  departmentId: schedules.departmentId,
  periodStart: schedules.periodStart,
  periodEnd: schedules.periodEnd,
  label: schedules.label,
  status: schedules.status,
  revision: schedules.revision,
  currentVersionId: schedules.currentVersionId,
  createdBy: schedules.createdBy,
};

type Row = Pick<typeof schedules.$inferSelect, keyof typeof columns>;

const toRecord = ({
  periodStart,
  periodEnd,
  ...rest
}: Row): ScheduleRecord => ({
  ...rest,
  period: { start: asIsoDate(periodStart), end: asIsoDate(periodEnd) },
});

export async function createSchedule(
  db: DbExecutor,
  input: {
    id?: string;
    departmentId: string;
    period: DatePeriod;
    label: string;
    createdBy: string;
  },
): Promise<ScheduleRecord> {
  const [row] = await db
    .insert(schedules)
    .values({
      id: input.id,
      departmentId: input.departmentId,
      periodStart: input.period.start,
      periodEnd: input.period.end,
      label: input.label,
      createdBy: input.createdBy,
    })
    .returning(columns);
  return toRecord(row!);
}

export async function findScheduleById(
  db: DbExecutor,
  id: string,
): Promise<ScheduleRecord | null> {
  const [row] = await db
    .select(columns)
    .from(schedules)
    .where(eq(schedules.id, id));
  return row ? toRecord(row) : null;
}

/**
 * Loads the schedule with `SELECT … FOR UPDATE`, blocking concurrent writers
 * (and other lockers) of this schedule until the transaction ends.
 */
export async function lockScheduleForUpdate(
  tx: Transaction,
  id: string,
): Promise<ScheduleRecord | null> {
  const [row] = await tx
    .select(columns)
    .from(schedules)
    .where(eq(schedules.id, id))
    .for("update");
  return row ? toRecord(row) : null;
}

export async function listSchedulesForDepartment(
  db: DbExecutor,
  departmentId: string,
): Promise<ScheduleRecord[]> {
  const rows = await db
    .select(columns)
    .from(schedules)
    .where(eq(schedules.departmentId, departmentId))
    .orderBy(asc(schedules.periodStart));
  return rows.map(toRecord);
}

/**
 * Applies a change only if `revision` still equals `expectedRevision`, and
 * bumps it. Returns null when another writer got there first (stale revision).
 */
export async function updateSchedule(
  db: DbExecutor,
  input: {
    id: string;
    expectedRevision: number;
    status?: ScheduleStatus;
    currentVersionId?: string;
  },
): Promise<ScheduleRecord | null> {
  const [row] = await db
    .update(schedules)
    .set({
      ...(input.status && { status: input.status }),
      ...(input.currentVersionId && {
        currentVersionId: input.currentVersionId,
      }),
      revision: sql`${schedules.revision} + 1`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schedules.id, input.id),
        eq(schedules.revision, input.expectedRevision),
      ),
    )
    .returning(columns);
  return row ? toRecord(row) : null;
}
