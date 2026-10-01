import { decide } from "../../domain/authz/policies";
import {
  acceptsChangeRequests,
  CHANGE_REQUEST_STATUSES,
  type ChangeRequestRejection,
  type ChangeRequestStatus,
  type ChangeRequestType,
  type SwapConsentStatus,
} from "../../domain/change-requests/model";
import {
  confirmRequestPlan,
  planRequestChange,
  type RequestResolution,
  type StaleRequestContext,
} from "../../domain/change-requests/plan-change";
import {
  decideChangeRequest,
  swapContextChanged,
} from "../../domain/change-requests/request";
import { compareIsoDates, type IsoDate } from "../../domain/shared/dates";
import { isInPeriod, type DatePeriod } from "../../domain/shared/period";
import { unwrap } from "../../domain/shared/result";
import type { ShiftCode } from "../../domain/shifts/shift-type";
import type { ScheduleStatus } from "../../domain/schedule/status";
import {
  listAssignments,
  listAssignmentsFor,
} from "../../infrastructure/repositories/assignments";
import {
  listChangeReasons,
  selectableReasons,
  type ChangeReasonRecord,
} from "../../infrastructure/repositories/change-reasons";
import {
  countChangeRequestsByStatus,
  findChangeRequest,
  listChangeRequestsForDepartment,
  listChangeRequestsForUser,
  type ChangeRequestRecord,
} from "../../infrastructure/repositories/change-requests";
import { listDepartmentsByIds } from "../../infrastructure/repositories/departments";
import {
  listRevisionStatuses,
  findOpenRevision,
} from "../../infrastructure/repositories/revisions";
import { listRoster } from "../../infrastructure/repositories/roster";
import { listScheduleChanges } from "../../infrastructure/repositories/schedule-changes";
import {
  findScheduleById,
  listSchedulesOnRoster,
  type ScheduleRecord,
} from "../../infrastructure/repositories/schedules";
import { listDisplayNames } from "../../infrastructure/repositories/users";
import {
  findVersionById,
  listVersionAssignments,
} from "../../infrastructure/repositories/versions";
import { NotFoundError } from "../errors";
import type { ActionError } from "../result";
import { toActionError } from "../result";
import {
  evaluateScheduleChange,
  previewOf,
  todayFor,
  type ChangePreview,
} from "../schedules/schedule-changes";
import {
  describePreview,
  type ChangePreviewView,
  type PreviewCell,
} from "../schedules/change-preview";
import { NO_STAFFING_REQUIREMENTS } from "../schedules/staffing-requirements";
import type { AppContext } from "../use-case";
import { toRequestState, visibleDayCells, workingDayCells } from "./context";

/**
 * Read side of Shift Change Requests. Scoping is enforced here, on the
 * server: a nurse lists only requests they made or are the swap partner of;
 * a Head Nurse lists only their department's queue (`changeRequest.review`).
 * An unknown, foreign or denied request is the same NotFoundError.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface Person {
  readonly userId: string;
  readonly displayName: string;
}

export interface ReasonView {
  readonly code: string;
  readonly label: string;
  readonly requiresNote: boolean;
}

/**
 * What became of an applied request's schedule change. APPLIED is the
 * request's own, final history; the change it led to may still be waiting
 * for approval in a revision, have been approved, or have been discarded
 * with its revision (then it is not in the executable schedule).
 *
 * - WORKING_COPY: applied to a schedule never approved since (awaiting approval)
 * - PENDING_REVISION: in a revision still open, submitted or returned
 * - APPROVED: included in an approval after it was applied
 * - DISCARDED: its revision was discarded; the approved version stayed as it was
 */
export type AppliedChangeState =
  "WORKING_COPY" | "PENDING_REVISION" | "APPROVED" | "DISCARDED";

export interface AppliedChangeInfo {
  readonly changeId: string;
  readonly revisionId: string | null;
  readonly state: AppliedChangeState;
}

/** One request as the screens show it (no internal ids beyond the request's and people's). */
export interface ChangeRequestView {
  readonly id: string;
  readonly scheduleId: string;
  readonly scheduleLabel: string;
  readonly departmentName: string;
  readonly type: ChangeRequestType;
  readonly date: IsoDate;
  readonly requester: Person;
  /** The requester's shift the request was made against. */
  readonly requesterShift: ShiftCode;
  readonly targetShift: ShiftCode | null;
  readonly counterpart: Person | null;
  readonly counterpartShift: ShiftCode | null;
  readonly reason: ReasonView;
  readonly note: string | null;
  readonly status: ChangeRequestStatus;
  readonly consent: SwapConsentStatus | null;
  readonly consentAt: Date | null;
  readonly createdAt: Date;
  readonly cancelledAt: Date | null;
  readonly rejectedAt: Date | null;
  readonly rejectedBy: Person | null;
  readonly rejection: ChangeRequestRejection | null;
  readonly rejectionNote: string | null;
  readonly appliedAt: Date | null;
  readonly appliedBy: Person | null;
  /** For an APPLIED request: its schedule change and what became of it. */
  readonly applied: AppliedChangeInfo | null;
}

async function appliedInfo(
  ctx: AppContext,
  requests: readonly ChangeRequestRecord[],
  scheduleOf: ReadonlyMap<string, ScheduleRecord>,
): Promise<Map<string, AppliedChangeInfo>> {
  const changes = await listScheduleChanges(ctx.db, {
    requestIds: requests.filter((r) => r.status === "APPLIED").map((r) => r.id),
  });
  const revisions = await listRevisionStatuses(
    ctx.db,
    changes.flatMap((c) => (c.revisionId ? [c.revisionId] : [])),
  );
  const info = new Map<string, AppliedChangeInfo>();
  for (const change of changes) {
    const revisionStatus = change.revisionId
      ? revisions.get(change.revisionId)
      : undefined;
    const state: AppliedChangeState = change.revisionId
      ? revisionStatus === "DISCARDED"
        ? "DISCARDED"
        : revisionStatus === "APPROVED"
          ? "APPROVED"
          : "PENDING_REVISION"
      : scheduleOf.get(change.scheduleId)?.currentVersionId
        ? "APPROVED"
        : "WORKING_COPY";
    info.set(change.requestId!, {
      changeId: change.id,
      revisionId: change.revisionId,
      state,
    });
  }
  return info;
}

async function toViews(
  ctx: AppContext,
  requests: readonly ChangeRequestRecord[],
): Promise<ChangeRequestView[]> {
  if (requests.length === 0) return [];
  const scheduleIds = [...new Set(requests.map((r) => r.scheduleId))];
  const [schedules, reasons, names] = await Promise.all([
    Promise.all(scheduleIds.map((id) => findScheduleById(ctx.db, id))),
    listChangeReasons(ctx.db),
    listDisplayNames(
      ctx.db,
      requests.flatMap((r) =>
        [r.requesterId, r.counterpartId, r.rejectedBy, r.appliedBy].filter(
          (id): id is string => id !== null,
        ),
      ),
    ),
  ]);
  const scheduleOf = new Map(
    schedules.filter((s) => s !== null).map((s) => [s.id, s]),
  );
  const departments = new Map(
    (
      await listDepartmentsByIds(ctx.db, [
        ...new Set([...scheduleOf.values()].map((s) => s.departmentId)),
      ])
    ).map((d) => [d.id, d.name]),
  );
  const reasonOf = new Map(reasons.map((r) => [r.code, r]));
  const applied = await appliedInfo(ctx, requests, scheduleOf);
  const person = (id: string | null): Person | null =>
    id ? { userId: id, displayName: names.get(id) ?? "—" } : null;

  return requests.map((r) => {
    const schedule = scheduleOf.get(r.scheduleId)!;
    const reason = reasonOf.get(r.reasonCode);
    return {
      id: r.id,
      scheduleId: r.scheduleId,
      scheduleLabel: schedule.label,
      departmentName: departments.get(schedule.departmentId) ?? "—",
      type: r.type,
      date: r.date,
      requester: person(r.requesterId)!,
      requesterShift: r.requesterShift,
      targetShift: r.targetShift,
      counterpart: person(r.counterpartId),
      counterpartShift: r.counterpartShift,
      reason: {
        code: r.reasonCode,
        label: reason?.label ?? r.reasonCode,
        requiresNote: reason?.requiresNote ?? false,
      },
      note: r.note,
      status: r.status,
      consent: r.consent,
      consentAt: r.consentAt,
      createdAt: r.createdAt,
      cancelledAt: r.cancelledAt,
      rejectedAt: r.rejectedAt,
      rejectedBy: person(r.rejectedBy),
      rejection: r.rejection,
      rejectionNote: r.rejectionNote,
      appliedAt: r.appliedAt,
      appliedBy: person(r.appliedBy),
      applied: applied.get(r.id) ?? null,
    };
  });
}

export interface MyChangeRequestItem extends ChangeRequestView {
  /** REQUESTER: the actor asked; COUNTERPART: the actor is the swap partner. */
  readonly role: "REQUESTER" | "COUNTERPART";
  /** The actor may cancel it now (own, pending, current member). */
  readonly canCancel: boolean;
  /** The actor may answer the swap now (partner, consent pending). */
  readonly canRespond: boolean;
  /**
   * A pending swap whose participants' shifts (as nurses see them) differ
   * from the request's snapshot: consent is refused and applying is blocked
   * until the requester refreshes it.
   */
  readonly swapContextChanged: boolean;
  /** The actor (the requester) may refresh the swap now. */
  readonly canRefresh: boolean;
}

/**
 * The actor's own requests and the swap requests that name them, newest
 * first, across departments (a former member keeps read-only history, D16).
 * Never anybody else's.
 */
export async function getMyChangeRequests(
  ctx: AppContext,
): Promise<MyChangeRequestItem[]> {
  const { actor } = ctx;
  const records = (
    await listChangeRequestsForUser(ctx.db, actor.userId)
  ).filter(
    (r) =>
      decide(actor, "changeRequest.view", {
        departmentId: r.departmentId,
        requesterId: r.requesterId,
        counterpartId: r.counterpartId,
      }).allowed,
  );
  const byId = new Map(records.map((r) => [r.id, r]));
  const changedSwaps = await changedPendingSwaps(ctx, records);
  return (await toViews(ctx, records)).map((view) => {
    const r = byId.get(view.id)!;
    const role = r.requesterId === actor.userId ? "REQUESTER" : "COUNTERPART";
    const pending = r.status === "PENDING";
    const mayChange =
      role === "REQUESTER" &&
      pending &&
      decide(actor, "changeRequest.cancel", {
        departmentId: r.departmentId,
        requesterId: r.requesterId,
      }).allowed;
    const swapContextChanged = changedSwaps.has(r.id);
    return {
      ...view,
      role,
      swapContextChanged,
      canRefresh: mayChange && swapContextChanged,
      canCancel: mayChange,
      canRespond:
        role === "COUNTERPART" &&
        pending &&
        r.consent === "PENDING" &&
        decide(actor, "changeRequest.consent", {
          departmentId: r.departmentId,
          counterpartId: r.counterpartId ?? "",
        }).allowed,
    };
  });
}

/** Pending swaps (one query per swap, only for those) whose context changed. */
async function changedPendingSwaps(
  ctx: AppContext,
  records: readonly ChangeRequestRecord[],
): Promise<Set<string>> {
  const swaps = records.filter(
    (r) => r.type === "SWAP" && r.status === "PENDING",
  );
  const changed = new Set<string>();
  for (const r of swaps) {
    const schedule = await findScheduleById(ctx.db, r.scheduleId);
    if (!schedule) continue;
    const { cells } = await visibleDayCells(
      ctx.db,
      schedule,
      [r.requesterId, r.counterpartId!],
      r.date,
    );
    if (
      swapContextChanged(toRequestState(r), {
        requester: cells.shiftOf(r.requesterId),
        counterpart: cells.shiftOf(r.counterpartId),
      })
    )
      changed.add(r.id);
  }
  return changed;
}

export interface RequestableAssignment {
  readonly date: IsoDate;
  readonly shift: ShiftCode;
  /** The actor already has an active request for this day. */
  readonly hasActiveRequest: boolean;
}

export interface SwapCandidate extends Person {
  /** Their shift that day as nurses see it; null = off. */
  readonly shift: ShiftCode | null;
}

export interface RequestableSchedule {
  readonly scheduleId: string;
  readonly label: string;
  readonly departmentName: string;
  readonly period: DatePeriod;
  readonly status: ScheduleStatus;
  /** The actor's own future assignments, as they see them (D11). */
  readonly assignments: readonly RequestableAssignment[];
  /** Per day of `assignments`: the other rostered nurses with a different shift. */
  readonly swapCandidates: Readonly<Record<IsoDate, readonly SwapCandidate[]>>;
}

export interface ChangeRequestOptions {
  readonly today: IsoDate;
  readonly schedules: readonly RequestableSchedule[];
  readonly reasons: readonly ReasonView[];
}

/**
 * What the actor may ask for now: schedules they are rostered on that accept
 * requests (FINALIZED on, D13; a current member), with their own future
 * assignments from what they see (the approved version, else the finalized
 * working copy), the swap candidates per day and the active request reasons.
 * Three queries per schedule, independent of department size.
 */
export async function getChangeRequestOptions(
  ctx: AppContext,
): Promise<ChangeRequestOptions> {
  const { actor, db } = ctx;
  const today = todayFor(ctx.clock?.() ?? new Date());
  const [rostered, reasons, mine] = await Promise.all([
    listSchedulesOnRoster(db, actor.userId),
    listChangeReasons(db),
    listChangeRequestsForUser(db, actor.userId),
  ]);
  const activeDays = new Set(
    mine
      .filter((r) => r.status === "PENDING" && r.requesterId === actor.userId)
      .map((r) => `${r.scheduleId}|${r.date}`),
  );
  const open = rostered.filter(
    (s) =>
      acceptsChangeRequests(s.status) &&
      compareIsoDates(s.period.end, today) >= 0 &&
      decide(actor, "changeRequest.submit", {
        departmentId: s.departmentId,
        status: s.status,
      }).allowed,
  );

  const schedules = await Promise.all(
    open.map(async (s): Promise<RequestableSchedule> => {
      const [roster, cells] = await Promise.all([
        listRoster(db, s.id),
        // What nurses see (D11): the approved version, else the working copy.
        s.currentVersionId
          ? listVersionAssignments(db, s.currentVersionId)
          : listAssignments(db, s.id),
      ]);
      const own = cells
        .filter(
          (a) =>
            a.nurseId === actor.userId &&
            compareIsoDates(a.date, today) >= 0 &&
            isInPeriod(s.period, a.date),
        )
        .sort((a, b) => compareIsoDates(a.date, b.date));
      const swapCandidates: Record<IsoDate, SwapCandidate[]> = {};
      for (const mineOnDay of own) {
        const shiftOf = new Map(
          cells
            .filter((a) => a.date === mineOnDay.date)
            .map((a) => [a.nurseId, a.shift]),
        );
        swapCandidates[mineOnDay.date] = roster
          .filter((r) => r.userId !== actor.userId)
          .map((r) => ({
            userId: r.userId,
            displayName: r.displayName,
            shift: shiftOf.get(r.userId) ?? null,
          }))
          .filter((c) => c.shift !== mineOnDay.shift);
      }
      return {
        scheduleId: s.id,
        label: s.label,
        departmentName: s.departmentName,
        period: s.period,
        status: s.status,
        assignments: own.map((a) => ({
          date: a.date,
          shift: a.shift,
          hasActiveRequest: activeDays.has(`${s.id}|${a.date}`),
        })),
        swapCandidates,
      };
    }),
  );
  return {
    today,
    schedules,
    reasons: selectableReasons(reasons, "REQUEST").map(reasonView),
  };
}

const reasonView = (r: ChangeReasonRecord): ReasonView => ({
  code: r.code,
  label: r.label,
  requiresNote: r.requiresNote || r.code === "OTHER",
});

/** Reasons a Head Nurse may choose for a direct adjustment. */
export async function getAdjustmentReasons(
  ctx: AppContext,
): Promise<ReasonView[]> {
  return selectableReasons(await listChangeReasons(ctx.db), "ADJUSTMENT").map(
    reasonView,
  );
}

export const QUEUE_LIMIT = 200;

export interface ChangeRequestQueueItem extends ChangeRequestView {
  /** Pending only: the involved nurses' shifts that day in the working copy now. */
  readonly current: {
    readonly requester: ShiftCode | null;
    readonly counterpart: ShiftCode | null;
  } | null;
}

export interface ChangeRequestQueue {
  readonly status: ChangeRequestStatus;
  readonly counts: Readonly<Record<ChangeRequestStatus, number>>;
  readonly items: readonly ChangeRequestQueueItem[];
}

/**
 * The department's request queue for one status (pending oldest first,
 * closed newest first, at most QUEUE_LIMIT). Only a Head Nurse of the
 * department (`changeRequest.review`); anyone else gets NotFoundError.
 */
export async function getChangeRequestQueue(
  ctx: AppContext,
  input: { departmentId: string; status?: ChangeRequestStatus },
): Promise<ChangeRequestQueue> {
  if (
    !decide(ctx.actor, "changeRequest.review", {
      departmentId: input.departmentId,
    }).allowed
  )
    throw new NotFoundError("Department");
  const status =
    input.status && CHANGE_REQUEST_STATUSES.includes(input.status)
      ? input.status
      : "PENDING";
  const [counts, records] = await Promise.all([
    countChangeRequestsByStatus(ctx.db, input.departmentId),
    listChangeRequestsForDepartment(ctx.db, {
      departmentId: input.departmentId,
      statuses: [status],
      limit: QUEUE_LIMIT,
    }),
  ]);
  // The live context of pending requests: one query per schedule involved.
  const pending = records.filter((r) => r.status === "PENDING");
  const live = new Map<string, ShiftCode>();
  for (const scheduleId of new Set(pending.map((r) => r.scheduleId))) {
    const mine = pending.filter((r) => r.scheduleId === scheduleId);
    for (const a of await listAssignmentsFor(ctx.db, {
      scheduleId,
      nurseIds: mine.flatMap((r) =>
        r.counterpartId ? [r.requesterId, r.counterpartId] : [r.requesterId],
      ),
      dates: mine.map((r) => r.date),
    }))
      live.set(`${scheduleId}|${a.nurseId}|${a.date}`, a.shift);
  }
  const shiftOf = (r: ChangeRequestRecord, nurseId: string | null) =>
    nurseId ? (live.get(`${r.scheduleId}|${nurseId}|${r.date}`) ?? null) : null;
  const byId = new Map(records.map((r) => [r.id, r]));
  const items = (await toViews(ctx, records)).map((view) => {
    const r = byId.get(view.id)!;
    return {
      ...view,
      current:
        r.status === "PENDING"
          ? {
              requester: shiftOf(r, r.requesterId),
              counterpart: shiftOf(r, r.counterpartId),
            }
          : null,
    };
  });
  return { status, counts, items };
}

export interface ChangeRequestReview {
  readonly request: ChangeRequestView;
  readonly schedule: {
    readonly id: string;
    readonly label: string;
    readonly period: DatePeriod;
    readonly status: ScheduleStatus;
    /** Send back with `applyChangeRequest` (optimistic concurrency). */
    readonly revision: number;
    readonly hasApprovedVersion: boolean;
    /** The executable (latest approved) version's number, if any. */
    readonly currentVersionNo: number | null;
    /** Days of the revision in progress, if one is open. */
    readonly openRevisionDates: readonly IsoDate[] | null;
  };
  /** The involved nurses' shifts that day in the working copy now. */
  readonly current: {
    readonly requester: ShiftCode | null;
    readonly counterpart: ShiftCode | null;
  };
  /** UNAVAILABLE / CHANGE_SHIFT / OTHER: the requester's assignment changed since the request. */
  readonly stale: StaleRequestContext | null;
  /** SWAP: either side changed since the request/consent (applying is blocked). */
  readonly swapContextChanged: boolean;
  /** Rostered nurses off that day (UNAVAILABLE: who could take the shift over). */
  readonly replacementCandidates: readonly Person[];
  /** The resolution the preview was computed with. */
  readonly resolution: RequestResolution;
  /**
   * Why the request cannot be applied as it stands (not pending, consent
   * missing, swap context changed, nothing would change, the schedule is
   * submitted, …), or null.
   */
  readonly blocker: ActionError | null;
  /** The validated outcome of applying it now (null when `blocker` is set first). */
  readonly preview: ChangePreview | null;
  /** `preview` as the screens show it. */
  readonly previewView: ChangePreviewView | null;
  /** The applied change, once applied, and what became of it. */
  readonly appliedChange:
    (AppliedChangeInfo & { readonly cells: readonly PreviewCell[] }) | null;
}

/**
 * One request of the department with everything the Head Nurse needs to
 * decide: the request, the involved nurses' CURRENT shifts, the stale-context
 * state, the schedule's version and revision context, and the validated
 * preview of applying it now with `resolution` (hard findings that would
 * block, warnings, staffing impact, whether a revision would be opened).
 * Nothing is written; applying re-checks everything under the row locks.
 */
export async function getChangeRequestReview(
  ctx: AppContext,
  input: {
    departmentId: string;
    requestId: string;
    resolution?: RequestResolution;
  },
): Promise<ChangeRequestReview> {
  const record = UUID.test(input.requestId)
    ? await findChangeRequest(ctx.db, input.requestId)
    : null;
  if (
    !record ||
    record.departmentId !== input.departmentId ||
    !decide(ctx.actor, "changeRequest.review", {
      departmentId: record.departmentId,
    }).allowed
  )
    throw new NotFoundError("Change request");
  const schedule = (await findScheduleById(ctx.db, record.scheduleId))!;
  const resolution = input.resolution ?? {};
  const replacementId = resolution.replacementNurseId ?? null;
  const [[request], roster, [applied], version, openRevision] =
    await Promise.all([
      toViews(ctx, [record]),
      listRoster(ctx.db, schedule.id),
      listScheduleChanges(ctx.db, { requestIds: [record.id] }),
      schedule.currentVersionId
        ? findVersionById(ctx.db, schedule.currentVersionId)
        : null,
      schedule.currentVersionId ? findOpenRevision(ctx.db, schedule.id) : null,
    ]);
  // Everyone's shift that day: the live context and the replacement candidates.
  const cells = await workingDayCells(
    ctx.db,
    schedule.id,
    roster.map((r) => r.userId),
    record.date,
  );
  const current = {
    requester: cells.shiftOf(record.requesterId),
    counterpart: cells.shiftOf(record.counterpartId),
  };
  const state = toRequestState(record);
  const pending = record.status === "PENDING";

  let stale: StaleRequestContext | null = null;
  let blocker: ActionError | null = null;
  let preview: ChangePreview | null = null;
  try {
    unwrap(decideChangeRequest(state, "APPLY"));
    const plan = unwrap(
      planRequestChange({
        request: state,
        current: { ...current, replacement: cells.shiftOf(replacementId) },
        rosterNurseIds: new Set(roster.map((r) => r.userId)),
        resolution,
      }),
    );
    stale = plan.stale;
    // The preview assumes the Head Nurse confirms a stale context.
    const edits = unwrap(
      confirmRequestPlan(plan, { ...resolution, confirmStaleContext: true }),
    );
    preview = await previewOf(() =>
      evaluateScheduleChange(ctx.db, schedule, edits, {
        today: todayFor(ctx.clock?.() ?? new Date()),
        staffing: ctx.staffing ?? NO_STAFFING_REQUIREMENTS,
      }),
    );
  } catch (error) {
    blocker = toActionError(error);
  }
  // Shown even when another blocker (e.g. missing consent) came first.
  if (
    pending &&
    record.type !== "SWAP" &&
    !stale &&
    current.requester !== record.requesterShift
  )
    stale = {
      nurseId: record.requesterId,
      date: record.date,
      requestedAgainst: record.requesterShift,
      current: current.requester,
    };
  const names = new Map(roster.map((r) => [r.userId, r.displayName]));
  return {
    request: request!,
    schedule: {
      id: schedule.id,
      label: schedule.label,
      period: schedule.period,
      status: schedule.status,
      revision: schedule.revision,
      hasApprovedVersion: schedule.currentVersionId !== null,
      currentVersionNo: version?.versionNo ?? null,
      openRevisionDates: openRevision?.dates ?? null,
    },
    current,
    stale,
    swapContextChanged:
      pending && record.type === "SWAP" && swapContextChanged(state, current),
    replacementCandidates:
      pending && record.type === "UNAVAILABLE"
        ? roster
            .filter(
              (r) =>
                r.userId !== record.requesterId &&
                cells.shiftOf(r.userId) === null,
            )
            .map((r) => ({ userId: r.userId, displayName: r.displayName }))
        : [],
    resolution,
    blocker,
    preview,
    previewView: preview
      ? await describePreview(ctx.db, schedule.period, preview)
      : null,
    appliedChange:
      applied && request!.applied
        ? {
            ...request!.applied,
            cells: applied.cells.map((c) => ({
              ...c,
              displayName: names.get(c.nurseId) ?? "—",
            })),
          }
        : null,
  };
}
