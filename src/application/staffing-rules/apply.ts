import { z } from "zod";

import { decide } from "../../domain/authz/policies";
import {
  compareValidation,
  type ValidationImpact,
} from "../../domain/rules/validation-summary";
import type { ScheduleStatus } from "../../domain/schedule/status";
import type { Decision } from "../../domain/shared/decision";
import { compareIsoDates, type IsoDate } from "../../domain/shared/dates";
import type { DatePeriod } from "../../domain/shared/period";
import { unwrap } from "../../domain/shared/result";
import { planApplyRuleSet } from "../../domain/staffing-rules/apply";
import type { RuleSetContent } from "../../domain/staffing-rules/model";
import type { DbExecutor } from "../../infrastructure/db/database";
import {
  extendRevisionScope,
  findOpenRevision,
} from "../../infrastructure/repositories/revisions";
import {
  findScheduleById,
  type ScheduleRecord,
} from "../../infrastructure/repositories/schedules";
import { insertRuleSetApplication } from "../../infrastructure/repositories/staffing-rules";
import { NO_HOLIDAY_DATA, type HolidayCalendar } from "../calendar/holidays";
import { ConflictError, NotFoundError } from "../errors";
import {
  loadScheduleForUpdate,
  saveSchedule,
} from "../schedules/load-for-update";
import { todayFor } from "../schedules/schedule-changes";
import {
  loadWorkingCopy,
  validateUnder,
} from "../schedules/working-copy-validation";
import { defineCommand, type AppContext } from "../use-case";
import { loadRuleSet, type LoadedRuleSet } from "./pinned";

/**
 * Apply another rule-set version to an existing schedule (D107, D109):
 * never automatic, always PREVIEW (no write) then explicit APPLY. Applying
 * changes only the schedule's pin, never an assignment. Hospital Admin or a
 * Supervisor of the department (`staffingRules.applyToSchedule`); they see
 * aggregate schedule data only (dates, buckets, counts), never nurses.
 */

/** `ConflictError.reason` when the pin changed since the preview. */
export const RULE_SET_PIN_CHANGED = "RULE_SET_PIN_CHANGED";

export interface RuleSetVersionSummary {
  readonly versionId: string;
  readonly versionNo: number;
  /** null: the Hospital Default. */
  readonly departmentId: string | null;
  readonly status: "DRAFT" | "PUBLISHED" | "RETIRED";
  readonly effectiveFrom: IsoDate | null;
  readonly legacyBaseline: boolean;
  readonly content: RuleSetContent;
}

export interface RuleSetApplicationPreview {
  readonly scheduleId: string;
  readonly label: string;
  readonly period: DatePeriod;
  readonly status: ScheduleStatus;
  /** The schedule revision the preview was computed at (send it with Apply). */
  readonly revision: number;
  readonly current: RuleSetVersionSummary;
  readonly target: RuleSetVersionSummary;
  /** Whether Apply is possible now, and why not (status or target). */
  readonly allowed: Decision<string>;
  /** The target is an earlier version of the same lineage (controlled rollback). */
  readonly rollback: boolean;
  /** Validation of the same assignments under the current and the target rules. */
  readonly impact: ValidationImpact;
  /** Days the Apply adds to the open revision's scope (new or worse coverage problems). */
  readonly revisionDatesToAdd: readonly IsoDate[];
  /** Always 0: Apply never changes an assignment. */
  readonly assignmentsChanged: 0;
}

const summary = (r: LoadedRuleSet): RuleSetVersionSummary => ({
  versionId: r.version.id,
  versionNo: r.version.versionNo,
  departmentId: r.version.departmentId,
  status: r.version.status,
  effectiveFrom: r.version.effectiveFrom,
  legacyBaseline: r.version.origin === "MIGRATION",
  content: r.content,
});

/** The target if it is applicable to the schedule's department at all, else NotFound. */
async function loadTarget(
  db: DbExecutor,
  schedule: ScheduleRecord,
  targetVersionId: string,
): Promise<LoadedRuleSet> {
  const target = await loadRuleSet(db, targetVersionId).catch(() => null);
  if (
    !target ||
    target.version.status === "DRAFT" ||
    (target.version.departmentId !== null &&
      target.version.departmentId !== schedule.departmentId)
  )
    throw new NotFoundError("Rule set version");
  return target;
}

/** Validation before/after on one load of the working copy; the revision days to add. */
async function evaluate(
  db: DbExecutor,
  schedule: ScheduleRecord,
  target: LoadedRuleSet,
  holidays: HolidayCalendar,
  today: IsoDate,
) {
  // Sequential: APPLY runs this on its transaction client.
  const loaded = await loadWorkingCopy(db, schedule, holidays);
  const current = await loadRuleSet(db, schedule.staffingRuleSetVersionId);
  const openRevision = schedule.currentVersionId
    ? await findOpenRevision(db, schedule.id)
    : null;
  const impact = compareValidation({
    period: schedule.period,
    assignments: loaded.assignments,
    before: validateUnder(schedule, loaded, current).violations,
    after: validateUnder(schedule, loaded, target).violations,
  });
  const scope = new Set(openRevision?.dates ?? []);
  // Past days cannot be changed any more (D72); only repairable days are added.
  const revisionDatesToAdd = openRevision
    ? impact.datesToRepair.filter(
        (d) => !scope.has(d) && compareIsoDates(d, today) >= 0,
      )
    : [];
  return { current, impact, openRevision, revisionDatesToAdd };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * PREVIEW (D107 N): validates the working copy under the current pin and
 * under the target and reports the impact. Writes nothing. A schedule of
 * another department, an unknown one, an inapplicable target and a denied
 * actor are the same NotFoundError.
 */
export async function previewRuleSetApplication(
  ctx: AppContext,
  input: { departmentId: string; scheduleId: string; targetVersionId: string },
): Promise<RuleSetApplicationPreview> {
  const schedule =
    UUID.test(input.scheduleId) && UUID.test(input.targetVersionId)
      ? await findScheduleById(ctx.db, input.scheduleId)
      : null;
  if (
    !schedule ||
    schedule.departmentId !== input.departmentId ||
    !decide(ctx.actor, "staffingRules.applyToSchedule", {
      departmentId: schedule.departmentId,
    }).allowed
  )
    throw new NotFoundError("Schedule");
  const target = await loadTarget(ctx.db, schedule, input.targetVersionId);
  const now = ctx.clock?.() ?? new Date();
  const { current, impact, revisionDatesToAdd } = await evaluate(
    ctx.db,
    schedule,
    target,
    ctx.holidays ?? NO_HOLIDAY_DATA,
    todayFor(now),
  );
  const plan = planApplyRuleSet({
    status: schedule.status,
    departmentId: schedule.departmentId,
    current: current.version,
    target: target.version,
  });
  return {
    scheduleId: schedule.id,
    label: schedule.label,
    period: schedule.period,
    status: schedule.status,
    revision: schedule.revision,
    current: summary(current),
    target: summary(target),
    allowed: plan.ok
      ? { allowed: true }
      : {
          allowed: false,
          reason:
            "attempted" in plan.error
              ? plan.error.attempted
              : (plan.error.reason ?? "INVALID_TARGET"),
        },
    rollback: plan.ok ? plan.value.rollback : false,
    impact,
    revisionDatesToAdd,
    assignmentsChanged: 0,
  };
}

export interface RuleSetApplicationOutput {
  readonly applicationId: string;
  /** The schedule revision after the Apply; send it with the next write. */
  readonly revision: number;
  readonly addedRevisionDates: readonly IsoDate[];
}

/**
 * APPLY (D107): requires explicit confirmation, the schedule revision and
 * the pin the preview was computed at (CONFLICT otherwise), re-computes
 * the impact under the row lock, changes only the pin (assignments are
 * untouched), bumps the schedule revision, adds the days that now need
 * repair to an open revision's scope (D109), records the application with
 * its impact and audits it. Refused in SUBMITTED and APPROVED.
 */
export const applyRuleSetToSchedule = defineCommand({
  name: "staffingRules.applyToSchedule",
  input: z.object({
    scheduleId: z.uuid(),
    expectedRevision: z.number().int().nonnegative(),
    fromVersionId: z.uuid(),
    toVersionId: z.uuid(),
    /** No Apply without explicit confirmation. */
    confirm: z.literal(true),
  }),
  async handler(uow, input): Promise<RuleSetApplicationOutput> {
    const schedule = await loadScheduleForUpdate(uow, input.scheduleId);
    uow.authorize("staffingRules.applyToSchedule", {
      departmentId: schedule.departmentId,
    });
    if (schedule.revision !== input.expectedRevision) throw new ConflictError();
    if (schedule.staffingRuleSetVersionId !== input.fromVersionId)
      throw new ConflictError(
        "The schedule's rule set changed since the preview",
        RULE_SET_PIN_CHANGED,
      );
    const target = await loadTarget(uow.tx, schedule, input.toVersionId);
    const today = todayFor(uow.now);
    const { current, impact, openRevision, revisionDatesToAdd } =
      await evaluate(uow.tx, schedule, target, uow.holidays, today);
    const plan = unwrap(
      planApplyRuleSet({
        status: schedule.status,
        departmentId: schedule.departmentId,
        current: current.version,
        target: target.version,
      }),
    );

    if (openRevision && revisionDatesToAdd.length > 0) {
      await extendRevisionScope(uow.tx, {
        revisionId: openRevision.id,
        dates: revisionDatesToAdd,
        addedBy: uow.actor.userId,
      });
      await uow.audit({
        departmentId: schedule.departmentId,
        scheduleId: schedule.id,
        action: "revision.scopeExtended",
        entityType: "revision",
        entityId: openRevision.id,
        data: {
          revisionId: openRevision.id,
          dates: revisionDatesToAdd,
          cause: "RULE_SET_APPLIED",
          toVersionId: target.version.id,
        },
      });
    }
    const saved = await saveSchedule(uow, schedule, {
      staffingRuleSetVersionId: target.version.id,
    });
    const recorded = {
      fromVersionNo: current.version.versionNo,
      fromDepartmentId: current.version.departmentId,
      toVersionNo: target.version.versionNo,
      toDepartmentId: target.version.departmentId,
      before: impact.before,
      after: impact.after,
      introduced: impact.introduced,
      becameNotReady: impact.becameNotReady,
      becameReady: impact.becameReady,
      addedRevisionDates: revisionDatesToAdd,
      assignmentsChanged: 0,
    };
    const applicationId = await insertRuleSetApplication(uow.tx, {
      scheduleId: schedule.id,
      fromVersionId: current.version.id,
      toVersionId: target.version.id,
      revisionId: openRevision?.id ?? null,
      rollback: plan.rollback,
      appliedBy: uow.actor.userId,
      appliedAt: uow.now,
      impact: recorded,
    });
    await uow.audit({
      departmentId: schedule.departmentId,
      scheduleId: schedule.id,
      action: "schedule.ruleSetApplied",
      entityType: "schedule_rule_set_application",
      entityId: applicationId,
      data: {
        fromVersionId: current.version.id,
        toVersionId: target.version.id,
        rollback: plan.rollback,
        status: schedule.status,
        revisionId: openRevision?.id ?? null,
        ...recorded,
      },
    });
    return {
      applicationId,
      revision: saved.revision,
      addedRevisionDates: revisionDatesToAdd,
    };
  },
});
