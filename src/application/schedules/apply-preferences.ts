import { z } from "zod";

import { authorize } from "../../domain/authz/policies";
import { planMonthlyPreferences } from "../../domain/preferences/apply-monthly";
import {
  InvalidStateError,
  RuleViolationError,
} from "../../domain/shared/errors";
import { unwrap } from "../../domain/shared/result";
import { APP_TIMEZONE, todayIn } from "../../infrastructure/auth/actor";
import { findDepartmentById } from "../../infrastructure/repositories/departments";
import { loadActor } from "../../infrastructure/repositories/memberships";
import { listAssignments } from "../../infrastructure/repositories/assignments";
import { listPreferences } from "../../infrastructure/repositories/preferences";
import { listRoster } from "../../infrastructure/repositories/roster";
import {
  listImportPeriodMembers,
  lockImportMemberships,
} from "../../infrastructure/repositories/schedule-import";
import { ConflictError, NotFoundError } from "../errors";
import { defineCommand } from "../use-case";
import { writeAssignmentChanges } from "./edit-assignments";
import {
  loadScheduleForAssignmentUpdate,
  saveSchedule,
} from "./load-for-update";
import { validateWorkingCopy } from "./working-copy-validation";

export const applyMonthlyPreferencesInput = z.object({
  scheduleId: z.uuid(),
  expectedRevision: z.number().int().nonnegative(),
});

export const applyMonthlyPreferences = defineCommand({
  name: "schedule.applyPreferences",
  input: applyMonthlyPreferencesInput,
  async handler(uow, input) {
    const schedule = await loadScheduleForAssignmentUpdate(
      uow,
      input.scheduleId,
    );
    uow.authorize("assignment.edit", { departmentId: schedule.departmentId });
    // Same lock order/eligibility protection as monthly import and Copy.
    await lockImportMemberships(uow.tx);
    const actor = await loadActor(
      uow.tx,
      uow.actor.userId,
      todayIn(APP_TIMEZONE, uow.now),
    );
    unwrap(
      authorize(actor ?? { ...uow.actor, isActive: false }, "assignment.edit", {
        departmentId: schedule.departmentId,
      }),
    );
    const department = await findDepartmentById(uow.tx, schedule.departmentId);
    if (!department?.isActive) throw new NotFoundError("Department");
    if (schedule.status !== "DRAFT" && schedule.status !== "PLANNING")
      throw new InvalidStateError(schedule.status, "APPLY_MONTHLY_PREFERENCES");
    if (schedule.revision !== input.expectedRevision) throw new ConflictError();

    const preferences = await listPreferences(uow.tx, schedule.id);
    const roster = await listRoster(uow.tx, schedule.id);
    const plan = planMonthlyPreferences({
      status: schedule.status,
      period: schedule.period,
      preferences,
      assignments: await listAssignments(uow.tx, schedule.id),
      rosterNurseIds: new Set(roster.map((r) => r.userId)),
      members: await listImportPeriodMembers(
        uow.tx,
        schedule.departmentId,
        schedule.period,
      ),
    });
    let revision = schedule.revision;
    if (plan.changes.length) {
      await writeAssignmentChanges(uow, schedule, plan.changes, {
        source: "PREFILL",
      });
      // Draft-correctable findings keep their severity and remain in the review.
      // Fail closed for structural or newly introduced, unclassified rule types.
      const validated = await validateWorkingCopy(
        uow.tx,
        schedule,
        uow.holidays,
      );
      const structural = validated.violations.filter(
        (v) =>
          v.rule !== "NIGHT_REST" &&
          v.rule !== "STAFFING" &&
          v.rule !== "UNDECIDED",
      );
      if (structural.length) throw new RuleViolationError(structural);
      revision = (await saveSchedule(uow, schedule, {})).revision;
      await uow.audit({
        action: "schedule.preferencesApplied",
        entityType: "schedule",
        entityId: schedule.id,
        scheduleId: schedule.id,
        departmentId: schedule.departmentId,
        data: {
          preferenceCount: preferences.length,
          assignmentCount: plan.changes.length,
          unchangedCount: plan.unchangedCount,
          skippedCount: plan.skipped.length,
        },
      });
    }
    const names = new Map(roster.map((r) => [r.userId, r.displayName]));
    return {
      revision,
      preferenceCount: preferences.length,
      assignmentCount: plan.changes.length,
      unchangedCount: plan.unchangedCount,
      skipped: plan.skipped.map((s) => ({
        ...s,
        displayName: names.get(s.nurseId) ?? null,
      })),
    };
  },
});
