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
import { decideChangeRequest } from "../../domain/change-requests/request";
import { compareIsoDates, type IsoDate } from "../../domain/shared/dates";
import { isInPeriod, type DatePeriod } from "../../domain/shared/period";
import { unwrap } from "../../domain/shared/result";
import type { ShiftCode } from "../../domain/shifts/shift-type";
import type { ScheduleStatus } from "../../domain/schedule/status";
import { listAssignments } from "../../infrastructure/repositories/assignments";
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
import { listRoster } from "../../infrastructure/repositories/roster";
import { listScheduleChanges } from "../../infrastructure/repositories/schedule-changes";
import {
  findScheduleById,
  listSchedulesOnRoster,
  type ScheduleRecord,
} from "../../infrastructure/repositories/schedules";
import { listDisplayNames } from "../../infrastructure/repositories/users";
import { listVersionAssignments } from "../../infrastructure/repositories/versions";
import { NotFoundError } from "../errors";
import type { ActionError } from "../result";
import { toActionError } from "../result";
import {
  evaluateScheduleChange,
  previewOf,
  todayFor,
  type ChangePreview,
} from "../schedules/schedule-changes";
import { NO_STAFFING_REQUIREMENTS } from "../schedules/staffing-requirements";
import type { AppContext } from "../use-case";
import { toRequestState, workingDayCells } from "./context";

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
  return (await toViews(ctx, records)).map((view) => {
    const r = byId.get(view.id)!;
    const role = r.requesterId === actor.userId ? "REQUESTER" : "COUNTERPART";
    const pending = r.status === "PENDING";
    return {
      ...view,
      role,
      canCancel:
        role === "REQUESTER" &&
        pending &&
        decide(actor, "changeRequest.cancel", {
          departmentId: r.departmentId,
          requesterId: r.requesterId,
        }).allowed,
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

export interface ChangeRequestQueue {
  readonly status: ChangeRequestStatus;
  readonly counts: Readonly<Record<ChangeRequestStatus, number>>;
  readonly items: readonly ChangeRequestView[];
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
  return { status, counts, items: await toViews(ctx, records) };
}

export interface ChangeRequestReview {
  readonly request: ChangeRequestView;
  readonly schedule: {
    readonly id: string;
    readonly status: ScheduleStatus;
    /** Send back with `applyChangeRequest` (optimistic concurrency). */
    readonly revision: number;
    readonly hasApprovedVersion: boolean;
  };
  /** The involved nurses' shifts that day in the working copy now. */
  readonly current: {
    readonly requester: ShiftCode | null;
    readonly counterpart: ShiftCode | null;
  };
  /** The requester's assignment changed since the request (soft; must be confirmed). */
  readonly stale: StaleRequestContext | null;
  /**
   * Why the request cannot be applied as it stands (not pending, consent
   * missing, swap context changed, nothing would change, the schedule is
   * submitted, …), or null.
   */
  readonly blocker: ActionError | null;
  /** The validated outcome of applying it now (null when `blocker` is set first). */
  readonly preview: ChangePreview | null;
  /** The applied change, once applied. */
  readonly appliedChange: {
    readonly changeId: string;
    readonly revisionId: string | null;
    readonly cells: readonly {
      readonly nurseId: string;
      readonly date: IsoDate;
      readonly before: ShiftCode | null;
      readonly after: ShiftCode | null;
    }[];
  } | null;
}

/**
 * One request of the department with everything the Head Nurse needs to
 * decide: the request, the involved nurses' current shifts, the stale-context
 * warning, and the validated preview of applying it with `resolution`
 * (hard findings that would block, warnings, staffing impact, whether a
 * revision would be opened). Nothing is written.
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
  const [[request], cells, [applied]] = await Promise.all([
    toViews(ctx, [record]),
    workingDayCells(
      ctx.db,
      schedule.id,
      [record.requesterId, record.counterpartId, replacementId].filter(
        (id): id is string => id !== null,
      ),
      record.date,
    ),
    listScheduleChanges(ctx.db, { requestIds: [record.id] }),
  ]);
  const current = {
    requester: cells.shiftOf(record.requesterId),
    counterpart: cells.shiftOf(record.counterpartId),
  };

  let stale: StaleRequestContext | null = null;
  let blocker: ActionError | null = null;
  let preview: ChangePreview | null = null;
  try {
    const state = toRequestState(record);
    unwrap(decideChangeRequest(state, "APPLY"));
    const roster = await listRoster(ctx.db, schedule.id);
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
  return {
    request: request!,
    schedule: scheduleSummary(schedule),
    current,
    stale,
    blocker,
    preview,
    appliedChange: applied
      ? {
          changeId: applied.id,
          revisionId: applied.revisionId,
          cells: applied.cells,
        }
      : null,
  };
}

const scheduleSummary = (s: ScheduleRecord) => ({
  id: s.id,
  status: s.status,
  revision: s.revision,
  hasApprovedVersion: s.currentVersionId !== null,
});
