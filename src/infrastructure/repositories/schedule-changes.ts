import { asc, eq, inArray } from "drizzle-orm";

import type { AssignmentChange } from "../../domain/schedule/assignment-editing";
import type { DbExecutor } from "../db/database";
import {
  scheduleChangeCells,
  scheduleChanges,
  type ScheduleChangeKind,
} from "../db/schema";
import { asIsoDate, asShiftCode } from "./mappers";

/**
 * Changes applied to a schedule after finalization (an applied request or a
 * Head Nurse adjustment), with their cells. Insert-only: no update or
 * delete exists, like the audit trail.
 */

export interface ScheduleChangeRecord {
  readonly id: string;
  readonly scheduleId: string;
  readonly kind: ScheduleChangeKind;
  readonly requestId: string | null;
  readonly revisionId: string | null;
  readonly reasonCode: string;
  readonly note: string | null;
  readonly appliedBy: string;
  readonly appliedAt: Date;
  readonly cells: readonly AssignmentChange[];
}

export async function insertScheduleChange(
  db: DbExecutor,
  input: Omit<ScheduleChangeRecord, "id">,
): Promise<string> {
  const [row] = await db
    .insert(scheduleChanges)
    .values({
      scheduleId: input.scheduleId,
      kind: input.kind,
      requestId: input.requestId,
      revisionId: input.revisionId,
      reasonCode: input.reasonCode,
      note: input.note,
      appliedBy: input.appliedBy,
      appliedAt: input.appliedAt,
    })
    .returning({ id: scheduleChanges.id });
  await db.insert(scheduleChangeCells).values(
    input.cells.map((c) => ({
      changeId: row!.id,
      userId: c.nurseId,
      date: c.date,
      beforeShiftCode: c.before,
      afterShiftCode: c.after,
    })),
  );
  return row!.id;
}

/** A schedule's applied changes, oldest first, with their cells. */
export async function listScheduleChanges(
  db: DbExecutor,
  filter: { scheduleId: string } | { requestIds: readonly string[] },
): Promise<ScheduleChangeRecord[]> {
  if ("requestIds" in filter && filter.requestIds.length === 0) return [];
  const changes = await db
    .select()
    .from(scheduleChanges)
    .where(
      "scheduleId" in filter
        ? eq(scheduleChanges.scheduleId, filter.scheduleId)
        : inArray(scheduleChanges.requestId, [...filter.requestIds]),
    )
    .orderBy(asc(scheduleChanges.appliedAt), asc(scheduleChanges.id));
  if (changes.length === 0) return [];
  const cells = await db
    .select()
    .from(scheduleChangeCells)
    .where(
      inArray(
        scheduleChangeCells.changeId,
        changes.map((c) => c.id),
      ),
    )
    .orderBy(asc(scheduleChangeCells.date), asc(scheduleChangeCells.userId));
  return changes.map((c) => ({
    id: c.id,
    scheduleId: c.scheduleId,
    kind: c.kind,
    requestId: c.requestId,
    revisionId: c.revisionId,
    reasonCode: c.reasonCode,
    note: c.note,
    appliedBy: c.appliedBy,
    appliedAt: c.appliedAt,
    cells: cells
      .filter((cell) => cell.changeId === c.id)
      .map((cell) => ({
        nurseId: cell.userId,
        date: asIsoDate(cell.date),
        before: cell.beforeShiftCode ? asShiftCode(cell.beforeShiftCode) : null,
        after: cell.afterShiftCode ? asShiftCode(cell.afterShiftCode) : null,
      })),
  }));
}
