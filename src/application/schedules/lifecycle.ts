import { createHash } from "node:crypto";

import { z } from "zod";

import { countActiveWindows } from "../../domain/preferences/preference-window";
import {
  transition,
  type ScheduleCommand,
} from "../../domain/schedule/state-machine";
import type { ScheduleStatus } from "../../domain/schedule/status";
import { InvalidStateError } from "../../domain/shared/errors";
import { unwrap } from "../../domain/shared/result";
import type { Assignment } from "../../domain/shifts/assignment";
import { APP_TIMEZONE, todayIn } from "../../infrastructure/auth/actor";
import { listAssignments } from "../../infrastructure/repositories/assignments";
import {
  listActiveHeadNurseIds,
  listActiveSupervisorIds,
} from "../../infrastructure/repositories/memberships";
import type { NewNotification } from "../../infrastructure/repositories/notifications";
import { listPreferenceWindows } from "../../infrastructure/repositories/preference-windows";
import { findOpenRevision } from "../../infrastructure/repositories/revisions";
import type { ScheduleRecord } from "../../infrastructure/repositories/schedules";
import {
  createSubmission,
  decideSubmission,
  findPendingSubmission,
  type SubmissionDecision,
  type SubmissionRecord,
} from "../../infrastructure/repositories/submissions";
import { createVersionFromWorkingCopy } from "../../infrastructure/repositories/versions";
import { ConflictError } from "../errors";
import { defineCommand, type UnitOfWork } from "../use-case";
import { loadScheduleForUpdate, saveSchedule } from "./load-for-update";
import { validateWorkingCopy } from "./working-copy-validation";

/**
 * The approval workflow (Phase 8): FINALIZE, SUBMIT and WITHDRAW by the Head
 * Nurse, APPROVE and RETURN by the Supervisor. Each is one transaction:
 *
 * 1. lock the schedule row (`FOR UPDATE`): every lifecycle command, edit and
 *    preference open/close of the schedule is serialized on it, so two
 *    transitions can never both act on the same state;
 * 2. authorize (for APPROVE / RETURN against the persisted submitter, so a
 *    Supervisor can never decide their own submission);
 * 3. check the caller's revision after authorizing (an outsider learns
 *    nothing): the loser of a race, or a stale tab, gets CONFLICT;
 * 4. gather the guard inputs (validation of the working copy, open windows)
 *    and let the state machine decide the next status;
 * 5. persist the status, the submission decision and, on approval, the
 *    immutable version; audit; notify. Any failure rolls all of it back.
 *
 * Assignments are never rewritten by a lifecycle command.
 */

/** Every lifecycle command carries the revision the caller saw (D30, D49). */
const lifecycleInput = z.object({
  scheduleId: z.uuid(),
  expectedRevision: z.number().int().nonnegative(),
});

/** Upper bound of a return comment (plain text, shown to the Head Nurse). */
export const RETURN_COMMENT_MAX_LENGTH = 1000;

export interface LifecycleOutput {
  readonly status: ScheduleStatus;
  /** The schedule revision after the transition; send it with the next write. */
  readonly revision: number;
  readonly submissionId?: string;
  readonly versionId?: string;
}

/**
 * A stable fingerprint of a working copy (SHA-256 over the sorted
 * nurse / day / shift cells). Recorded when a schedule is submitted and when
 * it is approved; equal values show the approved version is exactly what was
 * submitted, without storing a second copy of the assignments.
 */
export function assignmentsFingerprint(
  assignments: readonly Assignment[],
): string {
  const lines = assignments
    .map((a) => `${a.nurseId}|${a.date}|${a.shift}`)
    .sort();
  return createHash("sha256").update(lines.join("\n")).digest("hex");
}

async function lockAndCheckRevision(
  uow: UnitOfWork,
  input: { scheduleId: string; expectedRevision: number },
  authorize: (schedule: ScheduleRecord) => Promise<void> | void,
): Promise<ScheduleRecord> {
  const schedule = await loadScheduleForUpdate(uow, input.scheduleId);
  await authorize(schedule);
  // Checked after authorizing, so an outsider learns nothing from CONFLICT.
  if (schedule.revision !== input.expectedRevision) throw new ConflictError();
  return schedule;
}

const next = (schedule: ScheduleRecord, command: ScheduleCommand) =>
  unwrap(transition(schedule.status, command));

/** The pending submission of a SUBMITTED schedule (the state machine already checked the status). */
async function pendingSubmission(
  uow: UnitOfWork,
  schedule: ScheduleRecord,
  attempted: string,
): Promise<SubmissionRecord> {
  const pending = await findPendingSubmission(uow.tx, schedule.id);
  if (!pending) throw new InvalidStateError(schedule.status, attempted);
  return pending;
}

async function decide(
  uow: UnitOfWork,
  submission: SubmissionRecord,
  decision: SubmissionDecision,
  comment?: string,
): Promise<SubmissionRecord> {
  const decided = await decideSubmission(uow.tx, {
    id: submission.id,
    decision,
    decidedBy: uow.actor.userId,
    comment: comment ?? null,
    now: uow.now,
  });
  // Unreachable while the schedule row is locked; kept as the final guard.
  if (!decided) throw new ConflictError();
  return decided;
}

const auditBase = (schedule: ScheduleRecord) => ({
  departmentId: schedule.departmentId,
  scheduleId: schedule.id,
});

/** Workflow notifications go to people other than the actor. */
const notify = (
  uow: UnitOfWork,
  recipients: readonly string[],
  notification: Omit<NewNotification, "recipientId">,
) =>
  uow.notify(
    recipients
      .filter((id) => id !== uow.actor.userId)
      .map((recipientId) => ({ ...notification, recipientId })),
  );

/** "Today" for effective-dated relations (D19) is the Tehran calendar day. */
const today = (uow: UnitOfWork) => todayIn(APP_TIMEZONE, uow.now);

/**
 * PLANNING → FINALIZED. Blocked while the working copy has a blocking
 * finding (D7). Open preference windows are left as they are: the state
 * machine lets a FINALIZED schedule keep windows, and only SUBMIT needs them
 * closed (D58). Nurses see the working copy from FINALIZED on (D11).
 */
export const finalizeSchedule = defineCommand({
  name: "schedule.finalize",
  input: lifecycleInput,
  async handler(uow, input): Promise<LifecycleOutput> {
    const schedule = await lockAndCheckRevision(uow, input, (s) =>
      uow.authorize("schedule.finalize", { departmentId: s.departmentId }),
    );
    const { assignments, violations } = await validateWorkingCopy(
      uow.tx,
      schedule,
    );
    const status = next(schedule, { type: "FINALIZE", violations });
    const saved = await saveSchedule(uow, schedule, { status });

    await uow.audit({
      ...auditBase(schedule),
      action: "schedule.finalized",
      entityType: "schedule",
      entityId: schedule.id,
      data: {
        from: schedule.status,
        to: status,
        assignmentCount: assignments.length,
      },
    });
    return { status, revision: saved.revision };
  },
});

/**
 * FINALIZED (or RETURNED) → SUBMITTED. Blocked by a blocking finding and by
 * any active preference window (never closed implicitly here). Creates the
 * submission record; the working copy is locked from now on
 * (`assignmentsLockedIn`), so what the Supervisor approves is what was
 * submitted. Notifies the department's current Supervisors.
 */
export const submitSchedule = defineCommand({
  name: "schedule.submit",
  input: lifecycleInput,
  async handler(uow, input): Promise<LifecycleOutput> {
    const schedule = await lockAndCheckRevision(uow, input, (s) =>
      uow.authorize("schedule.submit", { departmentId: s.departmentId }),
    );
    const [{ assignments, violations }, windows] = await Promise.all([
      validateWorkingCopy(uow.tx, schedule),
      listPreferenceWindows(uow.tx, schedule.id),
    ]);
    const status = next(schedule, {
      type: "SUBMIT",
      violations,
      activePreferenceWindows: countActiveWindows(windows, uow.now),
    });

    // A revision of an approved schedule is submitted with its revision.
    const revision = schedule.currentVersionId
      ? await findOpenRevision(uow.tx, schedule.id)
      : null;
    const submission = await createSubmission(uow.tx, {
      scheduleId: schedule.id,
      submittedBy: uow.actor.userId,
      submittedAt: uow.now,
      revisionId: revision?.id ?? null,
    });
    const saved = await saveSchedule(uow, schedule, { status });

    await uow.audit({
      ...auditBase(schedule),
      action: "schedule.submitted",
      entityType: "submission",
      entityId: submission.id,
      data: {
        from: schedule.status,
        to: status,
        submissionId: submission.id,
        assignmentCount: assignments.length,
        assignmentsFingerprint: assignmentsFingerprint(assignments),
      },
    });
    await notify(
      uow,
      await listActiveSupervisorIds(uow.tx, schedule.departmentId, today(uow)),
      {
        type: "SCHEDULE_SUBMITTED",
        scheduleId: schedule.id,
        data: { label: schedule.label, submissionId: submission.id },
      },
    );
    return { status, revision: saved.revision, submissionId: submission.id };
  },
});

/**
 * SUBMITTED → FINALIZED (D10): the Head Nurse takes the submission back
 * before the Supervisor acts. The submission is kept and marked WITHDRAWN
 * (history is never deleted). Racing an approval or return, exactly one
 * wins: the row lock serializes them and the loser's revision is stale.
 * No notification (no type exists for it; the Supervisor's review page shows
 * the current state).
 */
export const withdrawSubmission = defineCommand({
  name: "schedule.withdraw",
  input: lifecycleInput,
  async handler(uow, input): Promise<LifecycleOutput> {
    const schedule = await lockAndCheckRevision(uow, input, (s) =>
      uow.authorize("schedule.withdraw", { departmentId: s.departmentId }),
    );
    const status = next(schedule, {
      type: "WITHDRAW",
      hasApprovedVersion: schedule.currentVersionId !== null,
    });
    const submission = await pendingSubmission(uow, schedule, "WITHDRAW");
    await decide(uow, submission, "WITHDRAWN");
    const saved = await saveSchedule(uow, schedule, { status });

    await uow.audit({
      ...auditBase(schedule),
      action: "schedule.withdrawn",
      entityType: "submission",
      entityId: submission.id,
      data: { from: schedule.status, to: status, submissionId: submission.id },
    });
    return { status, revision: saved.revision, submissionId: submission.id };
  },
});

/**
 * Loads the pending submission (if any) and authorizes a Supervisor decision
 * against its persisted submitter: `schedule.approve` / `schedule.return`
 * deny a Supervisor who is not assigned to the department and one who
 * submitted it (SELF_APPROVAL). Without a pending submission the policy is
 * still checked (so an outsider gets FORBIDDEN, never INVALID_STATE).
 */
async function authorizeSupervisorDecision(
  uow: UnitOfWork,
  schedule: ScheduleRecord,
  action: "schedule.approve" | "schedule.return",
): Promise<void> {
  const pending = await findPendingSubmission(uow.tx, schedule.id);
  uow.authorize(action, {
    departmentId: schedule.departmentId,
    submittedBy: pending?.submittedBy ?? "",
  });
}

/** Head Nurses of the department today: who hears about a decision. */
const headNurses = async (uow: UnitOfWork, schedule: ScheduleRecord) =>
  listActiveHeadNurseIds(uow.tx, schedule.departmentId, today(uow));

/**
 * SUBMITTED → APPROVED. Records the decision, snapshots the working copy as
 * the next immutable version (D17) and makes it the schedule's current
 * version, which nurses see from now on (D11). Does not start a revision.
 */
export const approveSchedule = defineCommand({
  name: "schedule.approve",
  input: lifecycleInput,
  async handler(uow, input): Promise<LifecycleOutput> {
    const schedule = await lockAndCheckRevision(uow, input, (s) =>
      authorizeSupervisorDecision(uow, s, "schedule.approve"),
    );
    const status = next(schedule, { type: "APPROVE" });
    const submission = await pendingSubmission(uow, schedule, "APPROVE");
    await decide(uow, submission, "APPROVED");
    const version = await createVersionFromWorkingCopy(uow.tx, {
      scheduleId: schedule.id,
      submissionId: submission.id,
      approvedBy: uow.actor.userId,
    });
    const assignments = await listAssignments(uow.tx, schedule.id);
    const saved = await saveSchedule(uow, schedule, {
      status,
      currentVersionId: version.id,
    });

    await uow.audit({
      ...auditBase(schedule),
      action: "schedule.approved",
      entityType: "submission",
      entityId: submission.id,
      data: {
        from: schedule.status,
        to: status,
        submissionId: submission.id,
        submittedBy: submission.submittedBy,
        versionId: version.id,
        versionNo: version.versionNo,
        assignmentCount: assignments.length,
        assignmentsFingerprint: assignmentsFingerprint(assignments),
      },
    });
    await notify(uow, await headNurses(uow, schedule), {
      type: "SCHEDULE_APPROVED",
      scheduleId: schedule.id,
      data: { label: schedule.label, versionNo: version.versionNo },
    });
    return {
      status,
      revision: saved.revision,
      submissionId: submission.id,
      versionId: version.id,
    };
  },
});

/**
 * SUBMITTED → RETURNED with the Supervisor's mandatory comment (trimmed,
 * 1–1000 characters). The comment is stored on the submission and in the
 * audit event's reason; the Head Nurse reads it on the schedule page. What
 * may be edited in RETURNED is Phase 7b's rule, unchanged.
 */
export const returnSchedule = defineCommand({
  name: "schedule.return",
  input: lifecycleInput.extend({
    comment: z.string().trim().min(1).max(RETURN_COMMENT_MAX_LENGTH),
  }),
  async handler(uow, input): Promise<LifecycleOutput> {
    const schedule = await lockAndCheckRevision(uow, input, (s) =>
      authorizeSupervisorDecision(uow, s, "schedule.return"),
    );
    const status = next(schedule, { type: "RETURN", comment: input.comment });
    const submission = await pendingSubmission(uow, schedule, "RETURN");
    await decide(uow, submission, "RETURNED", input.comment);
    const saved = await saveSchedule(uow, schedule, { status });

    await uow.audit({
      ...auditBase(schedule),
      action: "schedule.returned",
      entityType: "submission",
      entityId: submission.id,
      reason: input.comment,
      data: {
        from: schedule.status,
        to: status,
        submissionId: submission.id,
        submittedBy: submission.submittedBy,
      },
    });
    await notify(uow, await headNurses(uow, schedule), {
      type: "SCHEDULE_RETURNED",
      scheduleId: schedule.id,
      data: { label: schedule.label, submissionId: submission.id },
    });
    return { status, revision: saved.revision, submissionId: submission.id };
  },
});
