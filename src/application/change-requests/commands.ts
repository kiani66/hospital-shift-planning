import { z } from "zod";

import { CHANGE_REQUEST_TYPES } from "../../domain/change-requests/model";
import {
  confirmRequestPlan,
  planRequestChange,
} from "../../domain/change-requests/plan-change";
import { normalizeNote } from "../../domain/change-requests/reason";
import {
  decideChangeRequest,
  refreshSwap,
  respondToSwap,
  validateNewChangeRequest,
} from "../../domain/change-requests/request";
import { isIsoDate, type IsoDate } from "../../domain/shared/dates";
import { unwrap } from "../../domain/shared/result";
import { ASSIGNMENT_CODES, SHIFT_CODES } from "../../domain/shifts/shift-type";
import {
  PG_UNIQUE_VIOLATION,
  pgErrorCode,
} from "../../infrastructure/db/errors";
import { findChangeReason } from "../../infrastructure/repositories/change-reasons";
import {
  findActiveChangeRequest,
  findChangeRequest,
  insertChangeRequest,
  lockChangeRequest,
  updatePendingChangeRequest,
  type ChangeRequestRecord,
  type ChangeRequestUpdate,
} from "../../infrastructure/repositories/change-requests";
import { listActiveHeadNurseIds } from "../../infrastructure/repositories/memberships";
import type { NewNotification } from "../../infrastructure/repositories/notifications";
import {
  listRoster,
  listSchedulingRoster,
} from "../../infrastructure/repositories/roster";
import {
  findScheduleById,
  lockScheduleForShare,
  type ScheduleRecord,
} from "../../infrastructure/repositories/schedules";
import { ConflictError, NotFoundError } from "../errors";
import { defineCommand, type UnitOfWork } from "../use-case";
import { loadScheduleForAssignmentUpdate } from "../schedules/load-for-update";
import {
  todayFor,
  writeScheduleChange,
  type ScheduleChangeResult,
} from "../schedules/schedule-changes";
import { toRequestState, visibleDayCells, workingDayCells } from "./context";

/**
 * Shift Change Request commands (Phase 9). The nurse's commands (create,
 * cancel, refresh a swap) and the swap partner's answer only ever change the
 * request row; the schedule changes only when a Head Nurse of the department
 * applies a request (`applyChangeRequest`), which records a separate schedule
 * change. Every command is one transaction with its audit events and in-app
 * notifications. The actor is always the requester / partner / Head Nurse
 * themself: no command takes a user id for "who is acting".
 */

export const DUPLICATE_ACTIVE_REQUEST = "DUPLICATE_ACTIVE_REQUEST";

const isoDateInput = z
  .string()
  .refine(isIsoDate, "Expected a YYYY-MM-DD date")
  .transform((value) => value as IsoDate);

const requestRef = z.object({ requestId: z.uuid() });

const auditBase = (r: { departmentId: string; scheduleId: string }) => ({
  departmentId: r.departmentId,
  scheduleId: r.scheduleId,
});

/** Notifications go to people other than the actor. */
function notify(
  uow: UnitOfWork,
  recipients: readonly (string | null)[],
  notification: Omit<NewNotification, "recipientId">,
) {
  return uow.notify(
    [...new Set(recipients)]
      .filter((id): id is string => id !== null && id !== uow.actor.userId)
      .map((recipientId) => ({ ...notification, recipientId })),
  );
}

const notificationData = (
  schedule: { label: string },
  request: { id: string; date: IsoDate },
  extra: Record<string, unknown> = {},
) => ({
  label: schedule.label,
  requestId: request.id,
  date: request.date,
  ...extra,
});

async function loadRequestForUpdate(
  uow: UnitOfWork,
  requestId: string,
): Promise<ChangeRequestRecord> {
  const request = await lockChangeRequest(uow.tx, requestId);
  if (!request) throw new NotFoundError("Change request");
  return request;
}

async function scheduleOf(
  uow: UnitOfWork,
  request: ChangeRequestRecord,
): Promise<ScheduleRecord> {
  return (await findScheduleById(uow.tx, request.scheduleId))!;
}

/** Final guard: the row was locked and checked pending; a miss means it changed. */
async function update(
  uow: UnitOfWork,
  request: ChangeRequestRecord,
  changes: ChangeRequestUpdate,
) {
  if (
    !(await updatePendingChangeRequest(uow.tx, request.id, {
      ...changes,
      now: uow.now,
    }))
  )
    throw new ConflictError();
}

export const createChangeRequestInput = z.object({
  scheduleId: z.uuid(),
  type: z.enum(CHANGE_REQUEST_TYPES),
  date: isoDateInput,
  targetShift: z.enum(SHIFT_CODES).nullish(),
  counterpartId: z.uuid().nullish(),
  reasonCode: z.string().min(1).max(64),
  note: z.string().max(2000).nullish(),
});

/**
 * A nurse asks for a change to their OWN assignment (the requester is the
 * actor; a user id in the input is ignored). Needs a current membership and
 * a schedule from FINALIZED on (`changeRequest.submit`, D13), an assignment
 * on a day that is not past, an active request reason, and no other active
 * request of theirs for that day (DUPLICATE_ACTIVE_REQUEST; the partial
 * unique index is the final guard). The request snapshots what the nurse
 * sees (D11). Notifies the department's Head Nurses and, for a swap, the
 * partner, whose consent is needed. Never changes the schedule.
 */
export const createChangeRequest = defineCommand({
  name: "changeRequest.create",
  input: createChangeRequestInput,
  async handler(uow, input): Promise<{ id: string }> {
    // FOR SHARE: a concurrent status change waits for this request (and vice versa).
    const schedule = await lockScheduleForShare(uow.tx, input.scheduleId);
    if (!schedule) throw new NotFoundError("Schedule");
    uow.authorize("changeRequest.submit", {
      departmentId: schedule.departmentId,
      status: schedule.status,
    });

    const requesterId = uow.actor.userId;
    const counterpartId = input.counterpartId ?? null;
    const [roster, reason, visible] = await Promise.all([
      listSchedulingRoster(uow.tx, schedule.id),
      findChangeReason(uow.tx, input.reasonCode),
      visibleDayCells(
        uow.tx,
        schedule,
        counterpartId ? [requesterId, counterpartId] : [requesterId],
        input.date,
      ),
    ]);
    const request = unwrap(
      validateNewChangeRequest({
        type: input.type,
        date: input.date,
        today: todayFor(uow.now),
        schedule,
        requesterId,
        requesterShift: visible.cells.shiftOf(requesterId),
        targetShift: input.targetShift ?? null,
        counterpart: counterpartId
          ? {
              nurseId: counterpartId,
              shift: visible.cells.shiftOf(counterpartId),
            }
          : null,
        rosterNurseIds: new Set(roster.map((r) => r.userId)),
        reason,
        note: input.note ?? null,
      }),
    );

    const duplicate = () =>
      new ConflictError(
        "You already have an active request for this day",
        DUPLICATE_ACTIVE_REQUEST,
      );
    if (
      await findActiveChangeRequest(uow.tx, {
        scheduleId: schedule.id,
        requesterId,
        date: request.date,
      })
    )
      throw duplicate();
    let id: string;
    try {
      id = await insertChangeRequest(uow.tx, {
        ...request,
        scheduleId: schedule.id,
        versionId: visible.versionId,
        now: uow.now,
      });
    } catch (error) {
      if (pgErrorCode(error) === PG_UNIQUE_VIOLATION) throw duplicate();
      throw error;
    }

    await uow.audit({
      ...auditBase({
        departmentId: schedule.departmentId,
        scheduleId: schedule.id,
      }),
      action: "changeRequest.created",
      entityType: "change_request",
      entityId: id,
      reason: request.reasonCode,
      data: {
        requestId: id,
        type: request.type,
        date: request.date,
        requesterId,
        requesterShift: request.requesterShift,
        targetShift: request.targetShift,
        counterpartId: request.counterpartId,
        counterpartShift: request.counterpartShift,
        reasonCode: request.reasonCode,
        note: request.note,
        versionId: visible.versionId,
        scheduleStatus: schedule.status,
      },
    });
    const data = notificationData(schedule, { id, date: request.date });
    await notify(
      uow,
      await listActiveHeadNurseIds(
        uow.tx,
        schedule.departmentId,
        todayFor(uow.now),
      ),
      { type: "CHANGE_REQUEST_SUBMITTED", scheduleId: schedule.id, data },
    );
    if (request.counterpartId)
      await notify(uow, [request.counterpartId], {
        type: "SWAP_CONSENT_REQUESTED",
        scheduleId: schedule.id,
        data,
      });
    return { id };
  },
});

/**
 * The requester cancels their own pending request (a current member,
 * `changeRequest.cancel`). An applied, rejected or cancelled request cannot
 * be cancelled: a further correction is a new request or adjustment.
 */
export const cancelChangeRequest = defineCommand({
  name: "changeRequest.cancel",
  input: requestRef,
  async handler(uow, input) {
    const request = await loadRequestForUpdate(uow, input.requestId);
    uow.authorize("changeRequest.cancel", {
      departmentId: request.departmentId,
      requesterId: request.requesterId,
    });
    const status = unwrap(
      decideChangeRequest(toRequestState(request), "CANCEL"),
    );
    await update(uow, request, {
      status,
      cancelledAt: uow.now,
      cancelledBy: uow.actor.userId,
    });
    await uow.audit({
      ...auditBase(request),
      action: "changeRequest.cancelled",
      entityType: "change_request",
      entityId: request.id,
      data: { requestId: request.id, from: request.status, to: status },
    });
    return { status };
  },
});

/**
 * The swap partner (only them, `changeRequest.consent`) accepts or declines.
 * Accepting is refused when either side changed since the request (the
 * requester refreshes first); declining closes the request as REJECTED by
 * the partner and tells the requester.
 */
export const respondToSwapRequest = defineCommand({
  name: "changeRequest.respondToSwap",
  input: requestRef.extend({ accept: z.boolean() }),
  async handler(uow, input) {
    const request = await loadRequestForUpdate(uow, input.requestId);
    uow.authorize("changeRequest.consent", {
      departmentId: request.departmentId,
      counterpartId: request.counterpartId ?? "",
    });
    const schedule = await scheduleOf(uow, request);
    const { cells } = await visibleDayCells(
      uow.tx,
      schedule,
      [request.requesterId, request.counterpartId!],
      request.date,
    );
    const answer = unwrap(
      respondToSwap(toRequestState(request), {
        accept: input.accept,
        current: {
          requester: cells.shiftOf(request.requesterId),
          counterpart: cells.shiftOf(request.counterpartId),
        },
      }),
    );
    const declined = answer.status === "REJECTED";
    await update(uow, request, {
      status: answer.status,
      consentStatus: answer.consent,
      consentAt: uow.now,
      consentBy: uow.actor.userId,
      ...(declined && {
        rejectedAt: uow.now,
        rejectedBy: uow.actor.userId,
        rejection: "COUNTERPART_DECLINED" as const,
      }),
    });
    await uow.audit({
      ...auditBase(request),
      action: declined
        ? "changeRequest.swapDeclined"
        : "changeRequest.swapAccepted",
      entityType: "change_request",
      entityId: request.id,
      data: {
        requestId: request.id,
        consent: answer.consent,
        from: request.status,
        to: answer.status,
        requesterShift: request.requesterShift,
        counterpartShift: request.counterpartShift,
      },
    });
    if (declined)
      await notify(uow, [request.requesterId], {
        type: "CHANGE_REQUEST_REVIEWED",
        scheduleId: request.scheduleId,
        data: notificationData(schedule, request, {
          outcome: "REJECTED",
          rejection: "COUNTERPART_DECLINED",
        }),
      });
    return answer;
  },
});

/**
 * The requester re-confirms a swap whose context changed: the snapshot
 * becomes both nurses' current (visible) shifts and the partner is asked for
 * consent again; an earlier consent no longer counts. Unchanged swaps stay
 * as they are.
 */
export const refreshSwapRequest = defineCommand({
  name: "changeRequest.refreshSwap",
  input: requestRef,
  async handler(uow, input) {
    const request = await loadRequestForUpdate(uow, input.requestId);
    uow.authorize("changeRequest.cancel", {
      departmentId: request.departmentId,
      requesterId: request.requesterId,
    });
    const schedule = await scheduleOf(uow, request);
    const nurseIds = [request.requesterId];
    if (request.counterpartId) nurseIds.push(request.counterpartId);
    const { cells } = await visibleDayCells(
      uow.tx,
      schedule,
      nurseIds,
      request.date,
    );
    const refreshed = unwrap(
      refreshSwap(toRequestState(request), {
        requester: cells.shiftOf(request.requesterId),
        counterpart: cells.shiftOf(request.counterpartId),
      }),
    );
    if (!refreshed.changed) return { changed: false };

    await update(uow, request, {
      requesterShiftCode: refreshed.requesterShift,
      counterpartShiftCode: refreshed.counterpartShift,
      consentStatus: "PENDING",
      consentAt: null,
      consentBy: null,
    });
    await uow.audit({
      ...auditBase(request),
      action: "changeRequest.swapRefreshed",
      entityType: "change_request",
      entityId: request.id,
      data: {
        requestId: request.id,
        before: {
          requesterShift: request.requesterShift,
          counterpartShift: request.counterpartShift,
          consent: request.consent,
        },
        after: {
          requesterShift: refreshed.requesterShift,
          counterpartShift: refreshed.counterpartShift,
          consent: refreshed.consent,
        },
      },
    });
    await notify(uow, [request.counterpartId], {
      type: "SWAP_CONSENT_REQUESTED",
      scheduleId: request.scheduleId,
      data: notificationData(schedule, request),
    });
    return { changed: true };
  },
});

/**
 * A Head Nurse of the department rejects a pending request, with an optional
 * note the nurse sees. The schedule does not change.
 */
export const rejectChangeRequest = defineCommand({
  name: "changeRequest.reject",
  input: requestRef.extend({ note: z.string().max(2000).nullish() }),
  async handler(uow, input) {
    const request = await loadRequestForUpdate(uow, input.requestId);
    uow.authorize("changeRequest.review", {
      departmentId: request.departmentId,
    });
    const status = unwrap(
      decideChangeRequest(toRequestState(request), "REJECT"),
    );
    const note = unwrap(normalizeNote(input.note));
    await update(uow, request, {
      status,
      rejectedAt: uow.now,
      rejectedBy: uow.actor.userId,
      rejection: "HEAD_NURSE",
      rejectionNote: note,
    });
    await uow.audit({
      ...auditBase(request),
      action: "changeRequest.rejected",
      entityType: "change_request",
      entityId: request.id,
      reason: note,
      data: { requestId: request.id, from: request.status, to: status, note },
    });
    const schedule = await scheduleOf(uow, request);
    await notify(uow, [request.requesterId, request.counterpartId], {
      type: "CHANGE_REQUEST_REVIEWED",
      scheduleId: request.scheduleId,
      data: notificationData(schedule, request, {
        outcome: "REJECTED",
        rejection: "HEAD_NURSE",
      }),
    });
    return { status };
  },
});

export const applyChangeRequestInput = requestRef.extend({
  /** The schedule revision the Head Nurse's preview was read at. */
  expectedRevision: z.number().int().nonnegative(),
  /** UNAVAILABLE: who takes over the shift (optional). */
  replacementNurseId: z.uuid().nullish(),
  /** OTHER: the requester's resulting shift (null: undecided). */
  requesterShift: z.enum(ASSIGNMENT_CODES).nullable().optional(),
  /** The Head Nurse saw the changed context and applies against the current one. */
  confirmStaleContext: z.boolean().optional(),
});

export interface ApplyChangeRequestOutput extends ScheduleChangeResult {
  readonly requestId: string;
}

/**
 * A Head Nurse of the department applies a pending request: the only way a
 * request changes the schedule. The change is computed against the CURRENT
 * working copy (never the nurse's snapshot), with the stale-context rules
 * (`planRequestChange`, `confirmRequestPlan`): a swap needs the partner's
 * consent and an unchanged context. Then the shared post-finalization write
 * path validates and writes it (working copy, or a revision of an approved
 * schedule; a hard finding blocks, warnings do not). The request becomes
 * APPLIED; the change is a separate `schedule_changes` record. Locks the
 * schedule before the request (the order every writer uses).
 */
export const applyChangeRequest = defineCommand({
  name: "changeRequest.apply",
  input: applyChangeRequestInput,
  async handler(uow, input): Promise<ApplyChangeRequestOutput> {
    const found = await findChangeRequest(uow.tx, input.requestId);
    if (!found) throw new NotFoundError("Change request");
    const schedule = await loadScheduleForAssignmentUpdate(
      uow,
      found.scheduleId,
    );
    const request = await loadRequestForUpdate(uow, input.requestId);
    uow.authorize("changeRequest.apply", {
      departmentId: schedule.departmentId,
    });
    if (schedule.revision !== input.expectedRevision) throw new ConflictError();

    const state = toRequestState(request);
    unwrap(decideChangeRequest(state, "APPLY"));
    const replacementId = input.replacementNurseId ?? null;
    const nurseIds = [
      request.requesterId,
      request.counterpartId,
      replacementId,
    ].filter((id): id is string => id !== null);
    const [roster, cells] = await Promise.all([
      listRoster(uow.tx, schedule.id),
      workingDayCells(uow.tx, schedule.id, nurseIds, request.date),
    ]);
    const resolution = {
      replacementNurseId: replacementId,
      ...(input.requesterShift !== undefined && {
        requesterShift: input.requesterShift,
      }),
      confirmStaleContext: input.confirmStaleContext ?? false,
    };
    const plan = unwrap(
      planRequestChange({
        request: state,
        current: {
          requester: cells.shiftOf(request.requesterId),
          counterpart: cells.shiftOf(request.counterpartId),
          replacement: cells.shiftOf(replacementId),
        },
        rosterNurseIds: new Set(roster.map((r) => r.userId)),
        resolution,
      }),
    );
    const edits = unwrap(confirmRequestPlan(plan, resolution));

    const result = await writeScheduleChange(uow, schedule, {
      edits,
      kind: "REQUEST",
      requestId: request.id,
      reasonCode: request.reasonCode,
      note: request.note,
    });
    await update(uow, request, {
      status: "APPLIED",
      appliedAt: uow.now,
      appliedBy: uow.actor.userId,
    });
    await uow.audit({
      ...auditBase(request),
      action: "changeRequest.applied",
      entityType: "change_request",
      entityId: request.id,
      reason: request.reasonCode,
      data: {
        requestId: request.id,
        from: request.status,
        to: "APPLIED",
        changeId: result.changeId,
        mode: result.mode,
        revisionId: result.revisionId,
        cells: result.changes,
        staleContext: plan.stale,
        warnings: result.warnings.map((w) => w.rule),
      },
    });
    await notify(uow, [request.requesterId, request.counterpartId], {
      type: "CHANGE_REQUEST_REVIEWED",
      scheduleId: request.scheduleId,
      data: notificationData(schedule, request, { outcome: "APPLIED" }),
    });
    return { ...result, requestId: request.id };
  },
});
