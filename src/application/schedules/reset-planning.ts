import { z } from "zod";
import { authorize } from "../../domain/authz/policies";
import { InvalidStateError } from "../../domain/shared/errors";
import { unwrap } from "../../domain/shared/result";
import { APP_TIMEZONE, todayIn } from "../../infrastructure/auth/actor";
import { loadActor } from "../../infrastructure/repositories/memberships";
import { findDepartmentById } from "../../infrastructure/repositories/departments";
import {
  clearMonthlyPlanning,
  lockMonthlyResetAuthority,
  readMonthlyPlanningCounts,
} from "../../infrastructure/repositories/monthly-reset";
import {
  findScheduleById,
  type ScheduleRecord,
} from "../../infrastructure/repositories/schedules";
import { ConflictError, NotFoundError } from "../errors";
import { defineCommand, type AppContext } from "../use-case";
import {
  loadScheduleForAssignmentUpdate,
  saveSchedule,
} from "./load-for-update";

export const monthlyResetInput = z.object({
  scheduleId: z.uuid(),
  expectedRevision: z.number().int().nonnegative(),
});
export function assertMonthlyResetState(
  schedule: Pick<ScheduleRecord, "status" | "currentVersionId">,
  protectedHistory: number,
) {
  if (
    (schedule.status !== "DRAFT" && schedule.status !== "PLANNING") ||
    schedule.currentVersionId !== null ||
    protectedHistory > 0
  )
    throw new InvalidStateError(schedule.status, "RESET_PLANNING");
}
/** Consistent read-only preview: current membership, status, real counts. */
export async function previewMonthlyReset(ctx: AppContext, scheduleId: string) {
  z.uuid().parse(scheduleId);
  return ctx.db.transaction(
    async (tx) => {
      const schedule = await findScheduleById(tx, scheduleId);
      if (!schedule) throw new NotFoundError("Schedule");
      unwrap(
        authorize(ctx.actor, "schedule.resetPlanning", {
          departmentId: schedule.departmentId,
        }),
      );
      const actor = await loadActor(
        tx,
        ctx.actor.userId,
        todayIn(APP_TIMEZONE, ctx.clock?.()),
      );
      unwrap(
        authorize(
          actor ?? { ...ctx.actor, isActive: false },
          "schedule.resetPlanning",
          { departmentId: schedule.departmentId },
        ),
      );
      const department = await findDepartmentById(tx, schedule.departmentId);
      if (!department?.isActive) throw new NotFoundError("Department");
      const counts = await readMonthlyPlanningCounts(tx, schedule.id);
      assertMonthlyResetState(schedule, counts.protectedHistory);
      return {
        scheduleId: schedule.id,
        revision: schedule.revision,
        status: schedule.status,
        month: schedule.label,
        department: department.name,
        counts,
      };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}
export const resetMonthlyPlanning = defineCommand({
  name: "schedule.resetPlanning",
  input: monthlyResetInput,
  async handler(uow, input) {
    const schedule = await loadScheduleForAssignmentUpdate(
      uow,
      input.scheduleId,
    );
    uow.authorize("schedule.resetPlanning", {
      departmentId: schedule.departmentId,
    });
    await lockMonthlyResetAuthority(
      uow.tx,
      uow.actor.userId,
      schedule.departmentId,
    );
    const actor = await loadActor(
      uow.tx,
      uow.actor.userId,
      todayIn(APP_TIMEZONE, uow.now),
    );
    unwrap(
      authorize(
        actor ?? { ...uow.actor, isActive: false },
        "schedule.resetPlanning",
        { departmentId: schedule.departmentId },
      ),
    );
    const department = await findDepartmentById(uow.tx, schedule.departmentId);
    if (!department?.isActive) throw new NotFoundError("Department");
    const counts = await readMonthlyPlanningCounts(uow.tx, schedule.id);
    assertMonthlyResetState(schedule, counts.protectedHistory);
    if (schedule.revision !== input.expectedRevision) throw new ConflictError();
    if (!counts.assignments && !counts.changes && !counts.changeCells)
      return {
        revision: schedule.revision,
        status: schedule.status,
        counts,
        changed: false,
      };
    await clearMonthlyPlanning(uow.tx, schedule.id);
    const saved = await saveSchedule(uow, schedule, {});
    await uow.audit({
      action: "schedule.planningReset",
      entityType: "schedule",
      entityId: schedule.id,
      departmentId: schedule.departmentId,
      scheduleId: schedule.id,
      data: {
        assignmentsRemoved: counts.assignments,
        changesRemoved: counts.changes,
        changeCellsRemoved: counts.changeCells,
        status: schedule.status,
      },
    });
    return {
      revision: saved.revision,
      status: saved.status,
      counts,
      changed: true,
    };
  },
});
