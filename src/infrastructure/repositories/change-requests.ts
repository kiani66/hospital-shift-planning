import { and, asc, desc, eq, inArray, or, type SQL } from "drizzle-orm";

import type {
  ChangeRequestRejection,
  ChangeRequestStatus,
  ChangeRequestType,
  SwapConsentStatus,
} from "../../domain/change-requests/model";
import type { NewChangeRequest } from "../../domain/change-requests/request";
import type { IsoDate } from "../../domain/shared/dates";
import type { ShiftCode } from "../../domain/shifts/shift-type";
import type { DbExecutor, Transaction } from "../db/database";
import { schedules, shiftChangeRequests } from "../db/schema";
import { asIsoDate } from "./mappers";

/**
 * Phase 9 Shift Change Requests. This module stores requests only: nothing
 * here touches assignments (applying a request is a separate schedule
 * change, `schedule-changes.ts`). Requests are never deleted.
 */

export interface ChangeRequestRecord {
  readonly id: string;
  readonly scheduleId: string;
  readonly departmentId: string;
  readonly versionId: string | null;
  readonly requesterId: string;
  readonly type: ChangeRequestType;
  readonly date: IsoDate;
  readonly requesterShift: ShiftCode;
  readonly targetShift: ShiftCode | null;
  readonly counterpartId: string | null;
  readonly counterpartShift: ShiftCode | null;
  readonly reasonCode: string;
  readonly note: string | null;
  readonly status: ChangeRequestStatus;
  readonly consent: SwapConsentStatus | null;
  readonly consentAt: Date | null;
  readonly consentBy: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly cancelledAt: Date | null;
  readonly cancelledBy: string | null;
  readonly rejectedAt: Date | null;
  readonly rejectedBy: string | null;
  readonly rejection: ChangeRequestRejection | null;
  readonly rejectionNote: string | null;
  readonly appliedAt: Date | null;
  readonly appliedBy: string | null;
}

const r = shiftChangeRequests;
const columns = {
  id: r.id,
  scheduleId: r.scheduleId,
  departmentId: schedules.departmentId,
  versionId: r.versionId,
  requesterId: r.requesterId,
  type: r.type,
  date: r.date,
  requesterShift: r.requesterShiftCode,
  targetShift: r.targetShiftCode,
  counterpartId: r.counterpartId,
  counterpartShift: r.counterpartShiftCode,
  reasonCode: r.reasonCode,
  note: r.note,
  status: r.status,
  consent: r.consentStatus,
  consentAt: r.consentAt,
  consentBy: r.consentBy,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
  cancelledAt: r.cancelledAt,
  cancelledBy: r.cancelledBy,
  rejectedAt: r.rejectedAt,
  rejectedBy: r.rejectedBy,
  rejection: r.rejection,
  rejectionNote: r.rejectionNote,
  appliedAt: r.appliedAt,
  appliedBy: r.appliedBy,
};

type Row = { [K in keyof typeof columns]: unknown } & {
  date: string;
  requesterShift: string;
  targetShift: string | null;
  counterpartShift: string | null;
};

const toRecord = (row: Row): ChangeRequestRecord =>
  ({
    ...row,
    date: asIsoDate(row.date),
  }) as ChangeRequestRecord;

const select = (db: DbExecutor) =>
  db
    .select(columns)
    .from(r)
    .innerJoin(schedules, eq(schedules.id, r.scheduleId));

export async function insertChangeRequest(
  db: DbExecutor,
  input: NewChangeRequest & {
    readonly scheduleId: string;
    readonly versionId: string | null;
    readonly now: Date;
  },
): Promise<string> {
  const [row] = await db
    .insert(r)
    .values({
      scheduleId: input.scheduleId,
      versionId: input.versionId,
      requesterId: input.requesterId,
      type: input.type,
      date: input.date,
      requesterShiftCode: input.requesterShift,
      targetShiftCode: input.targetShift,
      counterpartId: input.counterpartId,
      counterpartShiftCode: input.counterpartShift,
      reasonCode: input.reasonCode,
      note: input.note,
      status: input.status,
      consentStatus: input.consent,
      createdAt: input.now,
      updatedAt: input.now,
    })
    .returning({ id: r.id });
  return row!.id;
}

export async function findChangeRequest(
  db: DbExecutor,
  id: string,
): Promise<ChangeRequestRecord | null> {
  const [row] = await select(db).where(eq(r.id, id));
  return row ? toRecord(row) : null;
}

/** Loads the request with `FOR UPDATE`: its decisions are serialized on this row. */
export async function lockChangeRequest(
  tx: Transaction,
  id: string,
): Promise<ChangeRequestRecord | null> {
  const [row] = await select(tx).where(eq(r.id, id)).for("update", { of: r });
  return row ? toRecord(row) : null;
}

/** The nurse's active (pending) request for that schedule and day, if any. */
export async function findActiveChangeRequest(
  db: DbExecutor,
  input: { scheduleId: string; requesterId: string; date: IsoDate },
): Promise<ChangeRequestRecord | null> {
  const [row] = await select(db).where(
    and(
      eq(r.scheduleId, input.scheduleId),
      eq(r.requesterId, input.requesterId),
      eq(r.date, input.date),
      eq(r.status, "PENDING"),
    ),
  );
  return row ? toRecord(row) : null;
}

/**
 * Requests the user made or is named in as swap partner, across departments
 * (a former member keeps their own history, D16). Newest first.
 */
export async function listChangeRequestsForUser(
  db: DbExecutor,
  userId: string,
): Promise<ChangeRequestRecord[]> {
  const rows = await select(db)
    .where(or(eq(r.requesterId, userId), eq(r.counterpartId, userId)))
    .orderBy(desc(r.createdAt), desc(r.id));
  return rows.map(toRecord);
}

/**
 * A department's requests in the given statuses: pending ones oldest first
 * (a queue), closed ones newest first, at most `limit`.
 */
export async function listChangeRequestsForDepartment(
  db: DbExecutor,
  input: {
    departmentId: string;
    statuses: readonly ChangeRequestStatus[];
    limit: number;
  },
): Promise<ChangeRequestRecord[]> {
  const pendingOnly =
    input.statuses.length === 1 && input.statuses[0] === "PENDING";
  const rows = await select(db)
    .where(
      and(
        eq(schedules.departmentId, input.departmentId),
        inArray(r.status, [...input.statuses]),
      ),
    )
    .orderBy(pendingOnly ? asc(r.createdAt) : desc(r.createdAt), asc(r.id))
    .limit(input.limit);
  return rows.map(toRecord);
}

/** Pending requests per status of a department (for the queue's tabs). */
export async function countChangeRequestsByStatus(
  db: DbExecutor,
  departmentId: string,
): Promise<Record<ChangeRequestStatus, number>> {
  const rows = await db
    .select({ status: r.status, id: r.id })
    .from(r)
    .innerJoin(schedules, eq(schedules.id, r.scheduleId))
    .where(eq(schedules.departmentId, departmentId));
  const counts = { PENDING: 0, CANCELLED: 0, REJECTED: 0, APPLIED: 0 };
  for (const row of rows) counts[row.status] += 1;
  return counts;
}

export type ChangeRequestUpdate = Partial<{
  status: ChangeRequestStatus;
  requesterShiftCode: ShiftCode;
  counterpartShiftCode: ShiftCode | null;
  consentStatus: SwapConsentStatus;
  consentAt: Date | null;
  consentBy: string | null;
  cancelledAt: Date;
  cancelledBy: string;
  rejectedAt: Date;
  rejectedBy: string;
  rejection: ChangeRequestRejection;
  rejectionNote: string | null;
  appliedAt: Date;
  appliedBy: string;
}>;

/**
 * Updates a request that is still pending (the final guard for every
 * decision; the caller already holds the row lock). False when it is not
 * pending any more.
 */
export async function updatePendingChangeRequest(
  db: DbExecutor,
  id: string,
  changes: ChangeRequestUpdate & { now: Date },
): Promise<boolean> {
  const { now, ...set } = changes;
  const where: SQL = and(eq(r.id, id), eq(r.status, "PENDING"))!;
  const rows = await db
    .update(r)
    .set({ ...set, updatedAt: now })
    .where(where)
    .returning({ id: r.id });
  return rows.length > 0;
}
