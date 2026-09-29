import { z } from "zod";

import { validateSchedule } from "../../../src/domain/rules/validate-schedule";
import { transition } from "../../../src/domain/schedule/state-machine";
import { unwrap } from "../../../src/domain/shared/result";
import {
  loadScheduleForUpdate,
  saveSchedule,
} from "../../../src/application/schedules/load-for-update";
import { defineCommand } from "../../../src/application/use-case";
import { listAssignments } from "../../../src/infrastructure/repositories/assignments";
import { listRoster } from "../../../src/infrastructure/repositories/roster";
import { createSubmission } from "../../../src/infrastructure/repositories/submissions";

/**
 * Test-only commands exercising the Phase 2 plumbing end to end. The real
 * workflow commands arrive in Phase 4+; these follow the same shape:
 * lock → authorize → domain → persist → audit → notify, in one transaction.
 */
export const openPreferencesForTest = defineCommand({
  name: "test.openPreferences",
  input: z.object({
    scheduleId: z.uuid(),
    expectedRevision: z.number().int().nonnegative(),
    event: z
      .enum(["OPEN_PREFERENCES", "START_PLANNING"])
      .default("OPEN_PREFERENCES"),
    failAfterWrites: z.boolean().default(false),
    skipAuthorization: z.boolean().default(false),
    holdLockMs: z.number().int().nonnegative().default(0),
  }),
  async handler(uow, input) {
    const schedule = await loadScheduleForUpdate(
      uow,
      input.scheduleId,
      input.expectedRevision,
    );
    if (!input.skipAuthorization)
      uow.authorize("schedule.openPreferences", {
        departmentId: schedule.departmentId,
      });

    const next = unwrap(transition(schedule.status, { type: input.event }));
    const saved = await saveSchedule(uow, schedule, { status: next });

    await uow.audit({
      action: "schedule.preferencesOpened",
      entityType: "schedule",
      entityId: schedule.id,
      departmentId: schedule.departmentId,
      scheduleId: schedule.id,
      data: { from: schedule.status, to: next },
    });
    const roster = await listRoster(uow.tx, schedule.id);
    await uow.notify(
      roster
        .filter((r) => r.userId !== uow.actor.userId)
        .map((r) => ({
          recipientId: r.userId,
          type: "PREFERENCES_OPENED" as const,
          scheduleId: schedule.id,
        })),
    );

    if (input.holdLockMs)
      await new Promise((r) => setTimeout(r, input.holdLockMs));
    if (input.failAfterWrites)
      throw new Error("simulated failure after writes; secret=do-not-leak");
    return { status: saved.status, revision: saved.revision, now: uow.now };
  },
});

export const finalizeForTest = defineCommand({
  name: "test.finalize",
  input: z.object({ scheduleId: z.uuid() }),
  async handler(uow, input) {
    const schedule = await loadScheduleForUpdate(uow, input.scheduleId);
    uow.authorize("schedule.finalize", { departmentId: schedule.departmentId });
    const violations = validateSchedule({
      period: schedule.period,
      assignments: await listAssignments(uow.tx, schedule.id),
    });
    await uow.audit({
      action: "schedule.finalizeAttempted",
      entityType: "schedule",
      scheduleId: schedule.id,
    });
    const next = unwrap(
      transition(schedule.status, { type: "FINALIZE", violations }),
    );
    return (await saveSchedule(uow, schedule, { status: next })).status;
  },
});

export const submitTwiceForTest = defineCommand({
  name: "test.submitTwice",
  input: z.object({ scheduleId: z.uuid() }),
  async handler(uow, input) {
    uow.authorize("schedule.submit", {
      departmentId: (await loadScheduleForUpdate(uow, input.scheduleId))
        .departmentId,
    });
    await createSubmission(uow.tx, {
      scheduleId: input.scheduleId,
      submittedBy: uow.actor.userId,
    });
    await createSubmission(uow.tx, {
      scheduleId: input.scheduleId,
      submittedBy: uow.actor.userId,
    });
  },
});
