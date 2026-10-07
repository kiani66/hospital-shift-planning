import { and, asc, eq, gte, lte, or, sql } from "drizzle-orm";

import { addDays } from "../../domain/shared/dates";
import type { DatePeriod } from "../../domain/shared/period";
import type { ScheduleStatus } from "../../domain/schedule/status";
import type { DbExecutor, Transaction } from "../db/database";
import { departments, scheduleRoster, schedules } from "../db/schema";
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
  /** The staffing rule-set version the schedule is validated against (D106). */
  readonly staffingRuleSetVersionId: string;
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
  staffingRuleSetVersionId: schedules.staffingRuleSetVersionId,
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
    /**
     * The pinned rule-set version. `createSchedule` (the use case) always
     * passes the version selected for the period; without it the column
     * default (the legacy baseline) applies, which only fixtures rely on.
     */
    staffingRuleSetVersionId?: string;
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
      staffingRuleSetVersionId: input.staffingRuleSetVersionId,
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

/**
 * Assignment writers acquire the target and both boundary schedules BEFORE
 * reading cells, in one global UUID order. Period/department are immutable;
 * the preliminary read is only for discovering this set, never for validation.
 * At most three rows (non-overlapping department periods) are locked.
 *
 * All working-copy writers use this protocol, including revision restoration.
 * A newly created neighbour starts empty; its first writer also locks this
 * target, even if it was not visible when this transaction discovered its set.
 * No account/request/membership lock may precede these schedule locks.
 */
export async function lockScheduleForAssignmentUpdate(
  tx: Transaction,
  id: string,
): Promise<ScheduleRecord | null> {
  const target = await findScheduleById(tx, id);
  if (!target) return null;
  const previousDay = addDays(target.period.start, -1);
  const nextDay = addDays(target.period.end, 1);
  const rows = await tx
    .select(columns)
    .from(schedules)
    .where(
      or(
        eq(schedules.id, id),
        and(
          eq(schedules.departmentId, target.departmentId),
          or(
            and(
              lte(schedules.periodStart, previousDay),
              gte(schedules.periodEnd, previousDay),
            ),
            and(
              lte(schedules.periodStart, nextDay),
              gte(schedules.periodEnd, nextDay),
            ),
          ),
        ),
      ),
    )
    .orderBy(asc(schedules.id))
    .for("update");
  const row = rows.find((row) => row.id === id);
  return row ? toRecord(row) : null;
}

/**
 * Loads the schedule with `SELECT … FOR SHARE`: many readers (e.g. nurses
 * saving preferences) may hold it together, but a writer taking
 * `FOR UPDATE` (closing preference collection, a status change) waits for
 * them, and they wait for it. Reads made after it see that writer's commit.
 */
export async function lockScheduleForShare(
  tx: Transaction,
  id: string,
): Promise<ScheduleRecord | null> {
  const [row] = await tx
    .select(columns)
    .from(schedules)
    .where(eq(schedules.id, id))
    .for("share");
  return row ? toRecord(row) : null;
}

/** The code of the schedule's department (for building links), or null. */
export async function findScheduleDepartmentCode(
  db: DbExecutor,
  scheduleId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ code: departments.code })
    .from(schedules)
    .innerJoin(departments, eq(departments.id, schedules.departmentId))
    .where(eq(schedules.id, scheduleId));
  return row?.code ?? null;
}

export interface RosteredScheduleRecord extends ScheduleRecord {
  readonly departmentName: string;
}

/** Every schedule the user is on the roster of, with its department name, oldest period first. */
export async function listSchedulesOnRoster(
  db: DbExecutor,
  userId: string,
): Promise<RosteredScheduleRecord[]> {
  const rows = await db
    .select({ ...columns, departmentName: departments.name })
    .from(schedules)
    .innerJoin(
      scheduleRoster,
      and(
        eq(scheduleRoster.scheduleId, schedules.id),
        eq(scheduleRoster.userId, userId),
      ),
    )
    .innerJoin(departments, eq(departments.id, schedules.departmentId))
    .orderBy(asc(schedules.periodStart), asc(schedules.id));
  return rows.map(({ departmentName, ...row }) => ({
    ...toRecord(row),
    departmentName,
  }));
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
 * A schedule of the department whose period shares at least one day with
 * `period` (periods are inclusive, D18), or null. The exclusion constraint
 * `schedules_period_no_overlap` stays the final guard against races.
 */
export async function findOverlappingSchedule(
  db: DbExecutor,
  departmentId: string,
  period: DatePeriod,
): Promise<ScheduleRecord | null> {
  const [row] = await db
    .select(columns)
    .from(schedules)
    .where(
      and(
        eq(schedules.departmentId, departmentId),
        lte(schedules.periodStart, period.end),
        gte(schedules.periodEnd, period.start),
      ),
    )
    .orderBy(asc(schedules.periodStart))
    .limit(1);
  return row ? toRecord(row) : null;
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
    /** Only an explicit Apply or a revision discard changes the pin (D106, D107). */
    staffingRuleSetVersionId?: string;
  },
): Promise<ScheduleRecord | null> {
  const [row] = await db
    .update(schedules)
    .set({
      ...(input.status && { status: input.status }),
      ...(input.currentVersionId && {
        currentVersionId: input.currentVersionId,
      }),
      ...(input.staffingRuleSetVersionId && {
        staffingRuleSetVersionId: input.staffingRuleSetVersionId,
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
