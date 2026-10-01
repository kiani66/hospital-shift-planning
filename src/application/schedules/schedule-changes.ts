import { z } from "zod";

import { decide } from "../../domain/authz/policies";
import { checkReason } from "../../domain/change-requests/reason";
import {
  assessChange,
  staffingImpact,
  type ChangeAssessment,
  type DayStaffingImpact,
} from "../../domain/rules/assess-change";
import { validateSchedule } from "../../domain/rules/validate-schedule";
import {
  assignmentKey,
  planAssignmentEdits,
  type AssignmentChange,
  type AssignmentEdit,
} from "../../domain/schedule/assignment-editing";
import {
  applyAssignmentEdits,
  planChangeTarget,
  planRevisionDiscard,
  type ScheduleChangeMode,
  type ScheduleChangeTarget,
} from "../../domain/schedule/schedule-change";
import { transition } from "../../domain/schedule/state-machine";
import type { ScheduleStatus } from "../../domain/schedule/status";
import {
  addDays,
  isIsoDate,
  uniqueSortedDates,
  type IsoDate,
} from "../../domain/shared/dates";
import {
  DomainError,
  InvalidStateError,
  RuleViolationError,
  ValidationError,
} from "../../domain/shared/errors";
import { MAX_PERIOD_DAYS } from "../../domain/shared/period";
import { unwrap } from "../../domain/shared/result";
import { SHIFT_CODES } from "../../domain/shifts/shift-type";
import { APP_TIMEZONE, todayIn } from "../../infrastructure/auth/actor";
import type { DbExecutor } from "../../infrastructure/db/database";
import type { ScheduleChangeKind } from "../../infrastructure/db/schema";
import {
  clearAssignment,
  listAdjacentAssignments,
  listAssignments,
  setAssignment,
} from "../../infrastructure/repositories/assignments";
import { findChangeReason } from "../../infrastructure/repositories/change-reasons";
import {
  closeRevision,
  extendRevisionScope,
  findOpenRevision,
  startRevision,
} from "../../infrastructure/repositories/revisions";
import { listRoster } from "../../infrastructure/repositories/roster";
import { insertScheduleChange } from "../../infrastructure/repositories/schedule-changes";
import {
  findScheduleById,
  type ScheduleRecord,
} from "../../infrastructure/repositories/schedules";
import { listVersionAssignments } from "../../infrastructure/repositories/versions";
import { ConflictError, NotFoundError } from "../errors";
import { toActionError, type ActionError } from "../result";
import { defineCommand, type AppContext, type UnitOfWork } from "../use-case";
import { assignmentAuditAction } from "./edit-assignments";
import { loadScheduleForUpdate, saveSchedule } from "./load-for-update";
import {
  NO_STAFFING_REQUIREMENTS,
  type StaffingRequirementsSource,
} from "./staffing-requirements";

/**
 * Post-finalization schedule changes (Phase 9): an applied change request or
 * a Head Nurse's direct operational adjustment. Both go through one path:
 *
 * 1. where the change goes (`planChangeTarget`): the working copy of a
 *    never-approved schedule, or a revision of an approved one (opened, or
 *    extended by the changed days); an APPROVED schedule and its versions
 *    are never edited in place;
 * 2. which cells change (`planAssignmentEdits`: roster, period, status and
 *    revision scope, exactly the editor's rules);
 * 3. validation of the destination before and after the change, with the
 *    neighbouring schedules' boundary days and configured staffing bounds:
 *    a new or worse hard finding on the changed cells blocks it
 *    (`assessChange`); warnings do not;
 * 4. on write: the revision step, the cells (audited one by one like the
 *    editor's), the `schedule_changes` record, and the schedule revision bump.
 *
 * `setAssignments` (the planning editor) is unchanged and stays the way to
 * plan a schedule before and between submissions.
 */

export interface ScheduleChangeEvaluation {
  readonly target: ScheduleChangeTarget;
  /** The cells that change, with the values they replace. */
  readonly changes: readonly AssignmentChange[];
  readonly assessment: ChangeAssessment;
  readonly staffing: readonly DayStaffingImpact[];
  /** The open revision the change goes into, if one exists already. */
  readonly openRevisionId: string | null;
}

/** "Today" for past-day checks: the Tehran calendar day (as everywhere else). */
export const todayFor = (now: Date) => todayIn(APP_TIMEZONE, now);

/**
 * Plans and validates a change against the schedule's CURRENT working copy
 * without writing anything. Throws the domain's errors (INVALID_STATE,
 * VALIDATION) when the change may not be made at all; a blocking finding is
 * reported in `assessment`, not thrown.
 */
export async function evaluateScheduleChange(
  db: DbExecutor,
  schedule: ScheduleRecord,
  edits: readonly AssignmentEdit[],
  options: {
    readonly today: IsoDate;
    readonly staffing: StaffingRequirementsSource;
  },
): Promise<ScheduleChangeEvaluation> {
  const hasApprovedVersion = schedule.currentVersionId !== null;
  const openRevision = hasApprovedVersion
    ? await findOpenRevision(db, schedule.id)
    : null;
  const target = unwrap(
    planChangeTarget({
      status: schedule.status,
      hasApprovedVersion,
      openRevisionDates: openRevision ? new Set(openRevision.dates) : null,
      dates: edits.map((e) => e.date),
      today: options.today,
    }),
  );

  const [roster, assignments] = await Promise.all([
    listRoster(db, schedule.id),
    listAssignments(db, schedule.id),
  ]);
  const changes = unwrap(
    planAssignmentEdits({
      edits,
      current: new Map(
        assignments.map((a) => [assignmentKey(a.nurseId, a.date), a.shift]),
      ),
      rosterNurseIds: new Set(roster.map((r) => r.userId)),
      schedule: {
        status: target.status,
        period: schedule.period,
        revisionDates: target.revisionDates,
      },
    }),
  );
  if (changes.length === 0)
    throw new ValidationError(
      "The schedule already has these shifts; nothing would change",
      "changes",
    );

  const after = applyAssignmentEdits(
    assignments,
    changes.map((c) => ({ nurseId: c.nurseId, date: c.date, shift: c.after })),
  );
  const dates = uniqueSortedDates(changes.map((c) => c.date));
  const { period } = schedule;
  const [adjacent, requirements] = await Promise.all([
    listAdjacentAssignments(db, {
      departmentId: schedule.departmentId,
      excludeScheduleId: schedule.id,
      nurseIds: roster.map((r) => r.userId),
      dates: [addDays(period.start, -1), addDays(period.end, 1)],
    }),
    options.staffing.requirementsFor({
      departmentId: schedule.departmentId,
      dates,
    }),
  ]);
  const validate = (cells: typeof assignments) =>
    validateSchedule({
      period,
      assignments: cells,
      adjacentAssignments: adjacent,
      staffingRequirements: requirements,
    });
  return {
    target,
    changes,
    assessment: assessChange({
      before: validate(assignments),
      after: validate(after),
      changedCells: changes,
    }),
    staffing: staffingImpact({
      before: assignments,
      after,
      dates,
      requirements,
    }),
    openRevisionId: openRevision?.id ?? null,
  };
}

export interface ScheduleChangeWrite {
  readonly edits: readonly AssignmentEdit[];
  readonly kind: ScheduleChangeKind;
  readonly requestId: string | null;
  readonly reasonCode: string;
  readonly note: string | null;
}

export interface ScheduleChangeResult {
  readonly changeId: string;
  readonly revisionId: string | null;
  readonly mode: ScheduleChangeMode;
  readonly status: ScheduleStatus;
  /** The schedule revision after the change; send it with the next write. */
  readonly revision: number;
  readonly changes: readonly AssignmentChange[];
  /** Soft findings the change introduced (shown, never blocking). */
  readonly warnings: ChangeAssessment["warnings"];
}

const auditBase = (schedule: ScheduleRecord) => ({
  departmentId: schedule.departmentId,
  scheduleId: schedule.id,
});

/**
 * Writes a validated change inside the caller's transaction; the caller has
 * locked the schedule row, authorized and checked the caller's revision.
 */
export async function writeScheduleChange(
  uow: UnitOfWork,
  schedule: ScheduleRecord,
  input: ScheduleChangeWrite,
): Promise<ScheduleChangeResult> {
  const evaluation = await evaluateScheduleChange(
    uow.tx,
    schedule,
    input.edits,
    { today: todayFor(uow.now), staffing: uow.staffing },
  );
  const { target, changes, assessment } = evaluation;
  if (assessment.blocked) throw new RuleViolationError(assessment.blocking);

  let status = schedule.status;
  let revisionId = evaluation.openRevisionId;
  const origin = { changeKind: input.kind, requestId: input.requestId };
  if (target.mode === "START_REVISION") {
    // An approved schedule is never edited in place (D17): open a revision.
    status = unwrap(transition(schedule.status, { type: "START_REVISION" }));
    revisionId = await startRevision(uow.tx, {
      scheduleId: schedule.id,
      reason: input.note
        ? `${input.reasonCode}: ${input.note}`
        : input.reasonCode,
      startedBy: uow.actor.userId,
      dates: target.addedRevisionDates,
    });
    await uow.audit({
      ...auditBase(schedule),
      action: "revision.started",
      entityType: "revision",
      entityId: revisionId,
      reason: input.reasonCode,
      data: {
        from: schedule.status,
        to: status,
        revisionId,
        dates: target.addedRevisionDates,
        ...origin,
      },
    });
  } else if (target.mode === "EXTEND_REVISION") {
    // RETURNED / REVISING after an approval always has its revision open.
    if (!revisionId)
      throw new InvalidStateError(schedule.status, "CHANGE_WITHOUT_REVISION");
    if (target.addedRevisionDates.length > 0) {
      await extendRevisionScope(uow.tx, {
        revisionId,
        dates: target.addedRevisionDates,
        addedBy: uow.actor.userId,
      });
      await uow.audit({
        ...auditBase(schedule),
        action: "revision.scopeExtended",
        entityType: "revision",
        entityId: revisionId,
        reason: input.reasonCode,
        data: { revisionId, dates: target.addedRevisionDates, ...origin },
      });
    }
  }

  const changeId = await insertScheduleChange(uow.tx, {
    scheduleId: schedule.id,
    kind: input.kind,
    requestId: input.requestId,
    revisionId,
    reasonCode: input.reasonCode,
    note: input.note,
    appliedBy: uow.actor.userId,
    appliedAt: uow.now,
    cells: changes,
  });
  for (const change of changes) {
    const cell = {
      scheduleId: schedule.id,
      userId: change.nurseId,
      date: change.date,
    };
    if (change.after === null) await clearAssignment(uow.tx, cell);
    else
      await setAssignment(uow.tx, {
        ...cell,
        shift: change.after,
        updatedBy: uow.actor.userId,
      });
    await uow.audit({
      ...auditBase(schedule),
      action: assignmentAuditAction(change),
      entityType: "assignment",
      entityId: `${change.nurseId}:${change.date}`,
      reason: input.reasonCode,
      data: {
        date: change.date,
        nurseId: change.nurseId,
        before: change.before,
        after: change.after,
        changeId,
        ...origin,
      },
    });
  }
  const saved = await saveSchedule(
    uow,
    schedule,
    status === schedule.status ? {} : { status },
  );
  return {
    changeId,
    revisionId,
    mode: target.mode,
    status,
    revision: saved.revision,
    changes,
    warnings: assessment.warnings,
  };
}

const isoDateInput = z
  .string()
  .refine(isIsoDate, "Expected a YYYY-MM-DD date")
  .transform((value) => value as IsoDate);

const cellChanges = z
  .array(
    z.object({
      nurseId: z.uuid(),
      date: isoDateInput,
      shift: z.enum(SHIFT_CODES).nullable(),
    }),
  )
  .min(1)
  .max(MAX_PERIOD_DAYS);

export const adjustScheduleInput = z.object({
  scheduleId: z.uuid(),
  expectedRevision: z.number().int().nonnegative(),
  changes: cellChanges,
  reasonCode: z.string().min(1).max(64),
  note: z.string().max(2000).nullish(),
});

/**
 * A Head Nurse's direct operational adjustment after finalization, with no
 * nurse request behind it (not a pretend swap): reason required (an active
 * adjustment reason; "Other" needs a note), validated like an applied
 * request, written to the working copy or a revision (never to an approved
 * version), audited as `schedule.adjusted` with every cell.
 */
export const adjustSchedule = defineCommand({
  name: "schedule.adjust",
  input: adjustScheduleInput,
  async handler(uow, input): Promise<ScheduleChangeResult> {
    const schedule = await loadScheduleForUpdate(uow, input.scheduleId);
    uow.authorize("schedule.adjust", { departmentId: schedule.departmentId });
    // Checked after authorizing, so an outsider learns nothing from CONFLICT.
    if (schedule.revision !== input.expectedRevision) throw new ConflictError();

    const reason = unwrap(
      checkReason({
        reason: await findChangeReason(uow.tx, input.reasonCode),
        usage: "ADJUSTMENT",
        note: input.note,
      }),
    );
    const result = await writeScheduleChange(uow, schedule, {
      edits: input.changes,
      kind: "ADJUSTMENT",
      requestId: null,
      reasonCode: reason.reasonCode,
      note: reason.note,
    });
    await uow.audit({
      ...auditBase(schedule),
      action: "schedule.adjusted",
      entityType: "schedule_change",
      entityId: result.changeId,
      reason: reason.reasonCode,
      data: {
        changeId: result.changeId,
        reasonCode: reason.reasonCode,
        note: reason.note,
        mode: result.mode,
        revisionId: result.revisionId,
        cells: result.changes,
        warnings: result.warnings.map((w) => w.rule),
      },
    });
    return result;
  },
});

/**
 * REVISING (or a returned revision) → APPROVED: the Head Nurse abandons the
 * revision. The working copy is restored from the latest approved version
 * (every differing cell, audited one by one), the revision is closed as
 * DISCARDED (kept, never deleted) and the approved version stays the
 * executable schedule. Requests already applied into the revision stay
 * APPLIED in their history; their schedule change is undone with it.
 */
export const discardRevision = defineCommand({
  name: "schedule.discardRevision",
  input: z.object({
    scheduleId: z.uuid(),
    expectedRevision: z.number().int().nonnegative(),
  }),
  async handler(uow, input) {
    const schedule = await loadScheduleForUpdate(uow, input.scheduleId);
    uow.authorize("schedule.discardRevision", {
      departmentId: schedule.departmentId,
    });
    if (schedule.revision !== input.expectedRevision) throw new ConflictError();

    const status = unwrap(
      transition(schedule.status, {
        type: "DISCARD_REVISION",
        hasApprovedVersion: schedule.currentVersionId !== null,
      }),
    );
    const revision = await findOpenRevision(uow.tx, schedule.id);
    if (!revision)
      throw new InvalidStateError(schedule.status, "DISCARD_REVISION");

    const [working, approved] = await Promise.all([
      listAssignments(uow.tx, schedule.id),
      listVersionAssignments(uow.tx, schedule.currentVersionId!),
    ]);
    const restored = planRevisionDiscard({ working, approved });
    for (const change of restored) {
      const cell = {
        scheduleId: schedule.id,
        userId: change.nurseId,
        date: change.date,
      };
      if (change.after === null) await clearAssignment(uow.tx, cell);
      else
        await setAssignment(uow.tx, {
          ...cell,
          shift: change.after,
          updatedBy: uow.actor.userId,
        });
      await uow.audit({
        ...auditBase(schedule),
        action: assignmentAuditAction(change),
        entityType: "assignment",
        entityId: `${change.nurseId}:${change.date}`,
        data: {
          date: change.date,
          nurseId: change.nurseId,
          before: change.before,
          after: change.after,
          revisionId: revision.id,
          restoredFromVersionId: schedule.currentVersionId,
        },
      });
    }
    await closeRevision(uow.tx, {
      id: revision.id,
      status: "DISCARDED",
      now: uow.now,
    });
    const saved = await saveSchedule(uow, schedule, { status });
    await uow.audit({
      ...auditBase(schedule),
      action: "revision.discarded",
      entityType: "revision",
      entityId: revision.id,
      data: {
        from: schedule.status,
        to: status,
        revisionId: revision.id,
        dates: revision.dates,
        restoredFromVersionId: schedule.currentVersionId,
        restoredCells: restored.length,
      },
    });
    return {
      status,
      revision: saved.revision,
      revisionId: revision.id,
      restored,
    };
  },
});

/** A preview's outcome: the evaluation, or why the change cannot be made at all. */
export type ChangePreview =
  | { readonly ok: true; readonly evaluation: ScheduleChangeEvaluation }
  | { readonly ok: false; readonly error: ActionError };

/** Runs an evaluation and reports a domain refusal as data (for preview screens). */
export async function previewOf(
  evaluate: () => Promise<ScheduleChangeEvaluation>,
): Promise<ChangePreview> {
  try {
    return { ok: true, evaluation: await evaluate() };
  } catch (error) {
    if (error instanceof DomainError)
      return { ok: false, error: toActionError(error) };
    throw error;
  }
}

/**
 * What an adjustment would do, without writing: where it goes, the cells,
 * new hard findings (which would block it), new warnings and the staffing
 * impact. Only a Head Nurse of the schedule's department may preview; anyone
 * else, and an unknown schedule, get NotFoundError.
 */
export async function previewScheduleAdjustment(
  ctx: AppContext,
  input: { scheduleId: string; changes: readonly AssignmentEdit[] },
): Promise<ChangePreview> {
  const schedule = await findScheduleById(ctx.db, input.scheduleId);
  if (
    !schedule ||
    !decide(ctx.actor, "schedule.adjust", {
      departmentId: schedule.departmentId,
    }).allowed
  )
    throw new NotFoundError("Schedule");
  return previewOf(() =>
    evaluateScheduleChange(ctx.db, schedule, input.changes, {
      today: todayFor(ctx.clock?.() ?? new Date()),
      staffing: ctx.staffing ?? NO_STAFFING_REQUIREMENTS,
    }),
  );
}
