import { z } from "zod";

import { createPeriod } from "../../domain/shared/period";
import { ValidationError } from "../../domain/shared/errors";
import { unwrap } from "../../domain/shared/result";
import { selectForSchedule } from "../../domain/staffing-rules/selection";
import { findDepartmentById } from "../../infrastructure/repositories/departments";
import {
  listRoster,
  snapshotRosterFromMemberships,
} from "../../infrastructure/repositories/roster";
import {
  createSchedule as insertSchedule,
  findOverlappingSchedule,
} from "../../infrastructure/repositories/schedules";
import { listApplicableRuleSetVersions } from "../../infrastructure/repositories/staffing-rules";
import { ConflictError, NotFoundError } from "../errors";
import { defineCommand } from "../use-case";
import { summarizeRoster, type RosterSummary } from "./roster-summary";

export const createScheduleInput = z.object({
  departmentId: z.uuid(),
  /** ISO dates; the domain checks order, length and real calendar days. */
  periodStart: z.string(),
  periodEnd: z.string(),
  /** Display label captured at creation (e.g. "آبان ۱۴۰۵"); never parsed as data. */
  label: z.string().trim().min(1).max(60),
});

export interface CreateScheduleOutput {
  readonly scheduleId: string;
  readonly revision: number;
  readonly roster: RosterSummary;
  /** The staffing rule-set version pinned for the whole period (D106). */
  readonly staffingRuleSetVersionId: string;
}

/** Reported when the new period shares a day with an existing schedule of the department (D18). */
export class ScheduleOverlapError extends ConflictError {
  constructor() {
    super("A schedule of this department already covers part of this period");
  }
}

/**
 * Head Nurse creates a schedule for a department they currently manage. The
 * schedule starts in the state machine's initial status (DRAFT, the column
 * default) and its roster is snapshotted from the memberships effective on at
 * least one day of the period (D19, D21). It pins exactly one staffing
 * rule-set version for the whole period: the department's override effective
 * on `period_start`, else the Hospital Default effective on it (D106). A
 * version that becomes effective later never changes the pin implicitly.
 */
export const createSchedule = defineCommand({
  name: "schedule.create",
  input: createScheduleInput,
  async handler(uow, input): Promise<CreateScheduleOutput> {
    uow.authorize("schedule.create", { departmentId: input.departmentId });

    const department = await findDepartmentById(uow.tx, input.departmentId);
    if (!department?.isActive) throw new NotFoundError("Department");

    const period = unwrap(createPeriod(input.periodStart, input.periodEnd));
    // Friendly check first; the exclusion constraint catches a concurrent insert.
    if (await findOverlappingSchedule(uow.tx, department.id, period))
      throw new ScheduleOverlapError();

    const versions = await listApplicableRuleSetVersions(uow.tx, department.id);
    const ruleSet = unwrap(
      selectForSchedule({
        department: versions.filter((v) => v.departmentId === department.id),
        hospital: versions.filter((v) => v.departmentId === null),
        periodStart: period.start,
      }),
    );

    const schedule = await insertSchedule(uow.tx, {
      departmentId: department.id,
      period,
      label: input.label,
      createdBy: uow.actor.userId,
      staffingRuleSetVersionId: ruleSet.id,
    });
    await snapshotRosterFromMemberships(uow.tx, {
      scheduleId: schedule.id,
      addedBy: uow.actor.userId,
    });
    const roster = summarizeRoster(await listRoster(uow.tx, schedule.id));
    if (roster.total === 0)
      throw new ValidationError(
        "No department member is effective on any day of this period",
        "period",
      );

    await uow.audit({
      action: "schedule.created",
      entityType: "schedule",
      entityId: schedule.id,
      departmentId: department.id,
      scheduleId: schedule.id,
      data: {
        periodStart: period.start,
        periodEnd: period.end,
        label: schedule.label,
        status: schedule.status,
        roster,
        staffingRuleSetVersionId: ruleSet.id,
        staffingRuleSetVersionNo: ruleSet.versionNo,
        staffingRuleSetDepartmentId: ruleSet.departmentId,
      },
    });

    return {
      scheduleId: schedule.id,
      revision: schedule.revision,
      roster,
      staffingRuleSetVersionId: ruleSet.id,
    };
  },
});
