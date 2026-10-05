import type { ChangeRequestState } from "../../domain/change-requests/request";
import type { IsoDate } from "../../domain/shared/dates";
import type { AssignmentCode } from "../../domain/shifts/shift-type";
import type { DbExecutor } from "../../infrastructure/db/database";
import { listAssignmentsFor } from "../../infrastructure/repositories/assignments";
import type { ChangeRequestRecord } from "../../infrastructure/repositories/change-requests";
import type { ScheduleRecord } from "../../infrastructure/repositories/schedules";
import { listVersionAssignmentsFor } from "../../infrastructure/repositories/versions";

/** The nurses' shifts on one day; a nurse without an entry is undecided. */
export interface DayCells {
  shiftOf(nurseId: string | null | undefined): AssignmentCode | null;
}

const cellsOf = (
  rows: readonly { nurseId: string; shift: AssignmentCode }[],
): DayCells => {
  const byNurse = new Map(rows.map((r) => [r.nurseId, r.shift]));
  return { shiftOf: (id) => (id ? (byNurse.get(id) ?? null) : null) };
};

/**
 * The shifts nurses see on a day where requests exist (D11, D13: from
 * FINALIZED on): the latest approved version once one exists, otherwise the
 * finalized working copy. Requests are made, consented
 * to and refreshed against this view, never against unapproved revision
 * edits. Returns the version read (null for the working copy).
 */
export async function visibleDayCells(
  db: DbExecutor,
  schedule: ScheduleRecord,
  nurseIds: readonly string[],
  date: IsoDate,
): Promise<{ cells: DayCells; versionId: string | null }> {
  const versionId = schedule.currentVersionId;
  const rows = versionId
    ? await listVersionAssignmentsFor(db, {
        versionId,
        nurseIds,
        dates: [date],
      })
    : await listAssignmentsFor(db, {
        scheduleId: schedule.id,
        nurseIds,
        dates: [date],
      });
  return { cells: cellsOf(rows), versionId };
}

/**
 * The shifts in the schedule's working copy on a day: the destination a
 * change is applied to (the Head Nurse's current context).
 */
export async function workingDayCells(
  db: DbExecutor,
  scheduleId: string,
  nurseIds: readonly string[],
  date: IsoDate,
): Promise<DayCells> {
  return cellsOf(
    await listAssignmentsFor(db, { scheduleId, nurseIds, dates: [date] }),
  );
}

export const toRequestState = (r: ChangeRequestRecord): ChangeRequestState => ({
  type: r.type,
  status: r.status,
  date: r.date,
  requesterId: r.requesterId,
  requesterShift: r.requesterShift,
  targetShift: r.targetShift,
  counterpartId: r.counterpartId,
  counterpartShift: r.counterpartShift,
  consent: r.consent,
});
