import type { ScheduleStatus } from "../../domain/schedule/status";
import {
  lockScheduleForUpdate,
  lockScheduleForAssignmentUpdate,
  updateSchedule,
  type ScheduleRecord,
} from "../../infrastructure/repositories/schedules";
import { ConflictError, NotFoundError } from "../errors";
import type { UnitOfWork } from "../use-case";

/**
 * Locks the schedule row for the rest of the transaction and checks the
 * caller's `expectedRevision` (optimistic concurrency from the client).
 */
export async function loadScheduleForUpdate(
  uow: UnitOfWork,
  scheduleId: string,
  expectedRevision?: number,
): Promise<ScheduleRecord> {
  const schedule = await lockScheduleForUpdate(uow.tx, scheduleId);
  if (!schedule) throw new NotFoundError("Schedule");
  if (expectedRevision !== undefined && schedule.revision !== expectedRevision)
    throw new ConflictError();
  return schedule;
}

/** Shared boundary-lock protocol for every working-copy assignment writer. */
export async function loadScheduleForAssignmentUpdate(
  uow: UnitOfWork,
  scheduleId: string,
): Promise<ScheduleRecord> {
  const schedule = await lockScheduleForAssignmentUpdate(uow.tx, scheduleId);
  if (!schedule) throw new NotFoundError("Schedule");
  return schedule;
}

/** Persists a change to a locked schedule and bumps its revision. */
export async function saveSchedule(
  uow: UnitOfWork,
  schedule: ScheduleRecord,
  changes: {
    status?: ScheduleStatus;
    currentVersionId?: string;
    staffingRuleSetVersionId?: string;
  },
): Promise<ScheduleRecord> {
  const saved = await updateSchedule(uow.tx, {
    id: schedule.id,
    expectedRevision: schedule.revision,
    ...changes,
  });
  if (!saved) throw new ConflictError();
  return saved;
}
