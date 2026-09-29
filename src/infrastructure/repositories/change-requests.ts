import { asc, desc, eq, inArray } from "drizzle-orm";

import type { IsoDate } from "../../domain/shared/dates";
import type { ShiftCode } from "../../domain/shifts/shift-type";
import type { DbExecutor } from "../db/database";
import {
  schedules,
  shiftChangeRequestItems,
  shiftChangeRequests,
} from "../db/schema";
import { asIsoDate, asShiftCode } from "./mappers";

export type ChangeRequestStatus =
  "PENDING" | "ACKNOWLEDGED" | "DECLINED" | "RESOLVED" | "WITHDRAWN";

export interface ChangeRequestItem {
  readonly date: IsoDate;
  readonly currentShift: ShiftCode | null;
  /** Null means "cannot work this day". */
  readonly desiredShift: ShiftCode | null;
}

export interface ChangeRequestRecord {
  readonly id: string;
  readonly scheduleId: string;
  readonly departmentId: string;
  readonly requesterId: string;
  readonly counterpartUserId: string | null;
  readonly reason: string;
  readonly status: ChangeRequestStatus;
  readonly createdAt: Date;
  readonly reviewedBy: string | null;
  readonly reviewNote: string | null;
  readonly items: readonly ChangeRequestItem[];
}

/** Stores the request only. It never touches assignments (no automatic swaps). */
export async function createChangeRequest(
  db: DbExecutor,
  input: {
    scheduleId: string;
    requesterId: string;
    counterpartUserId?: string | null;
    reason: string;
    items: readonly ChangeRequestItem[];
  },
): Promise<string> {
  const [row] = await db
    .insert(shiftChangeRequests)
    .values({
      scheduleId: input.scheduleId,
      requesterId: input.requesterId,
      counterpartUserId: input.counterpartUserId ?? null,
      reason: input.reason,
    })
    .returning({ id: shiftChangeRequests.id });
  await db.insert(shiftChangeRequestItems).values(
    input.items.map((item) => ({
      requestId: row!.id,
      date: item.date,
      currentShiftCode: item.currentShift,
      desiredShiftCode: item.desiredShift,
    })),
  );
  return row!.id;
}

async function withItems(
  db: DbExecutor,
  rows: RequestRow[],
): Promise<ChangeRequestRecord[]> {
  if (rows.length === 0) return [];
  const items = await db
    .select()
    .from(shiftChangeRequestItems)
    .where(
      inArray(
        shiftChangeRequestItems.requestId,
        rows.map((r) => r.id),
      ),
    )
    .orderBy(asc(shiftChangeRequestItems.date));
  return rows.map((r) => ({
    id: r.id,
    scheduleId: r.scheduleId,
    departmentId: r.departmentId,
    requesterId: r.requesterId,
    counterpartUserId: r.counterpartUserId,
    reason: r.reason,
    status: r.status,
    createdAt: r.createdAt,
    reviewedBy: r.reviewedBy,
    reviewNote: r.reviewNote,
    items: items
      .filter((i) => i.requestId === r.id)
      .map((i) => ({
        date: asIsoDate(i.date),
        currentShift: i.currentShiftCode
          ? asShiftCode(i.currentShiftCode)
          : null,
        desiredShift: i.desiredShiftCode
          ? asShiftCode(i.desiredShiftCode)
          : null,
      })),
  }));
}

const requestWithDepartment = {
  id: shiftChangeRequests.id,
  scheduleId: shiftChangeRequests.scheduleId,
  requesterId: shiftChangeRequests.requesterId,
  counterpartUserId: shiftChangeRequests.counterpartUserId,
  reason: shiftChangeRequests.reason,
  status: shiftChangeRequests.status,
  createdAt: shiftChangeRequests.createdAt,
  reviewedBy: shiftChangeRequests.reviewedBy,
  reviewNote: shiftChangeRequests.reviewNote,
  departmentId: schedules.departmentId,
};

type RequestRow = Omit<ChangeRequestRecord, "items">;

export async function findChangeRequest(
  db: DbExecutor,
  id: string,
): Promise<ChangeRequestRecord | null> {
  const rows = await db
    .select(requestWithDepartment)
    .from(shiftChangeRequests)
    .innerJoin(schedules, eq(schedules.id, shiftChangeRequests.scheduleId))
    .where(eq(shiftChangeRequests.id, id));
  const [record] = await withItems(db, rows);
  return record ?? null;
}

/** A nurse's own requests across departments, including ones from departments they left (D16). */
export async function listChangeRequestsForRequester(
  db: DbExecutor,
  requesterId: string,
): Promise<ChangeRequestRecord[]> {
  const rows = await db
    .select(requestWithDepartment)
    .from(shiftChangeRequests)
    .innerJoin(schedules, eq(schedules.id, shiftChangeRequests.scheduleId))
    .where(eq(shiftChangeRequests.requesterId, requesterId))
    .orderBy(desc(shiftChangeRequests.createdAt));
  return withItems(db, rows);
}

export async function listChangeRequestsForSchedule(
  db: DbExecutor,
  scheduleId: string,
): Promise<ChangeRequestRecord[]> {
  const rows = await db
    .select(requestWithDepartment)
    .from(shiftChangeRequests)
    .innerJoin(schedules, eq(schedules.id, shiftChangeRequests.scheduleId))
    .where(eq(shiftChangeRequests.scheduleId, scheduleId))
    .orderBy(asc(shiftChangeRequests.createdAt));
  return withItems(db, rows);
}

/** Records a status change (review, withdrawal). Only the request row changes, never assignments. */
export async function updateChangeRequestStatus(
  db: DbExecutor,
  input: {
    id: string;
    status: ChangeRequestStatus;
    reviewedBy?: string;
    reviewNote?: string | null;
    resolvedRevisionId?: string | null;
    now: Date;
  },
): Promise<boolean> {
  const rows = await db
    .update(shiftChangeRequests)
    .set({
      status: input.status,
      ...(input.reviewedBy && {
        reviewedBy: input.reviewedBy,
        reviewedAt: input.now,
      }),
      ...(input.reviewNote !== undefined && { reviewNote: input.reviewNote }),
      ...(input.resolvedRevisionId !== undefined && {
        resolvedRevisionId: input.resolvedRevisionId,
      }),
    })
    .where(eq(shiftChangeRequests.id, input.id))
    .returning({ id: shiftChangeRequests.id });
  return rows.length > 0;
}
