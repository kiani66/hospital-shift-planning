import type { ScheduleStatus } from "../schedule/status";
import { compareIsoDates, type IsoDate } from "../shared/dates";
import { InvalidStateError, ValidationError } from "../shared/errors";
import { isInPeriod, type DatePeriod } from "../shared/period";
import { err, ok, type Result } from "../shared/result";
import {
  isWorkingShift,
  type AssignmentCode,
  type ShiftCode,
} from "../shifts/shift-type";
import {
  acceptsChangeRequests,
  CHANGE_REQUEST_REFUSALS,
  type ChangeRequestStatus,
  type ChangeRequestType,
  type SwapConsentStatus,
} from "./model";
import { checkReason, type ChangeReason } from "./reason";

/** The swap partner named by the requester, with their shift that day as the requester saw it. */
export interface SwapCounterpart {
  readonly nurseId: string;
  /** Null: no explicit decision is recorded for the partner. */
  readonly shift: AssignmentCode | null;
}

export interface NewChangeRequestInput {
  readonly type: ChangeRequestType;
  readonly date: IsoDate;
  /** Today in the department's timezone: requests for past days are refused. */
  readonly today: IsoDate;
  readonly schedule: {
    readonly status: ScheduleStatus;
    readonly period: DatePeriod;
  };
  readonly requesterId: string;
  /** The requester's shift that day as they see it (D11); null when undecided. */
  readonly requesterShift: AssignmentCode | null;
  /** CHANGE_SHIFT only: the shift asked for. */
  readonly targetShift: ShiftCode | null;
  /** SWAP only. */
  readonly counterpart: SwapCounterpart | null;
  readonly rosterNurseIds: ReadonlySet<string>;
  /** The chosen reason; null when the code is unknown. */
  readonly reason: ChangeReason | null;
  readonly note: string | null;
}

/** A validated new request, as it is stored (with the snapshot it was made against). */
export interface NewChangeRequest {
  readonly type: ChangeRequestType;
  readonly date: IsoDate;
  readonly requesterId: string;
  readonly requesterShift: AssignmentCode;
  readonly targetShift: ShiftCode | null;
  readonly counterpartId: string | null;
  readonly counterpartShift: AssignmentCode | null;
  readonly reasonCode: string;
  readonly note: string | null;
  readonly status: "PENDING";
  /** PENDING for a swap (the partner must answer); null otherwise. */
  readonly consent: SwapConsentStatus | null;
}

const invalid = (message: string, field: string) =>
  err(new ValidationError(message, field));

/**
 * Validates a nurse's new request against the schedule as they see it.
 *
 * - The schedule must be finalized or later (D13); before that, preferences
 *   are the way to ask.
 * - The day must lie in the period and not in the past (historical
 *   correction is out of scope).
 * - It is about the requester's own assignment: they must be on the roster
 *   and work that day.
 * - CHANGE_SHIFT names a different shift; SWAP names another rostered nurse
 *   whose shift that day differs (same day, same schedule); other types name
 *   neither.
 * - The reason must be an active request reason; "Other" needs a note.
 *
 * Who may ask (the actor is the requester, a current member) is the policy's
 * job; one active request per nurse and day is the store's.
 */
export function validateNewChangeRequest(
  input: NewChangeRequestInput,
): Result<NewChangeRequest, ValidationError | InvalidStateError> {
  const { type, date, schedule, requesterShift, counterpart } = input;
  if (!acceptsChangeRequests(schedule.status))
    return err(
      new InvalidStateError(
        schedule.status,
        CHANGE_REQUEST_REFUSALS.SCHEDULE_NOT_ACCEPTING,
      ),
    );
  if (!isInPeriod(schedule.period, date))
    return invalid("The date is outside the schedule period", "date");
  if (compareIsoDates(date, input.today) < 0)
    return invalid("Requests for past days are not possible", "date");
  if (!input.rosterNurseIds.has(input.requesterId))
    return invalid("You are not on this schedule's roster", "requesterId");
  if (requesterShift === null)
    return invalid("You have no assignment on this day", "date");

  if (type === "UNAVAILABLE" && !isWorkingShift(requesterShift))
    return invalid("Unavailability requires a working shift", "type");

  if (type === "CHANGE_SHIFT") {
    if (input.targetShift === null)
      return invalid("Choose the shift you are asking for", "targetShift");
    if (input.targetShift === requesterShift)
      return invalid(
        "The requested shift is the one already assigned",
        "targetShift",
      );
  } else if (input.targetShift !== null)
    return invalid("Only a shift change names a shift", "targetShift");

  if (type === "SWAP") {
    if (!counterpart)
      return invalid("Choose the nurse to swap with", "counterpartId");
    if (counterpart.nurseId === input.requesterId)
      return invalid("You cannot swap with yourself", "counterpartId");
    if (!input.rosterNurseIds.has(counterpart.nurseId))
      return invalid(
        "The other nurse is not on this schedule's roster",
        "counterpartId",
      );
    if (counterpart.shift === requesterShift)
      return invalid(
        "The other nurse has the same shift; a swap would change nothing",
        "counterpartId",
      );
  } else if (counterpart)
    return invalid("Only a swap names another nurse", "counterpartId");

  const reason = checkReason({
    reason: input.reason,
    usage: "REQUEST",
    note: input.note,
  });
  if (!reason.ok) return reason;

  return ok({
    type,
    date,
    requesterId: input.requesterId,
    requesterShift,
    targetShift: input.targetShift,
    counterpartId: counterpart?.nurseId ?? null,
    counterpartShift: counterpart?.shift ?? null,
    reasonCode: reason.value.reasonCode,
    note: reason.value.note,
    status: "PENDING",
    consent: type === "SWAP" ? "PENDING" : null,
  });
}

/** A stored request as the lifecycle functions need it. */
export interface ChangeRequestState {
  readonly type: ChangeRequestType;
  readonly status: ChangeRequestStatus;
  readonly date: IsoDate;
  readonly requesterId: string;
  /** Snapshot: the requester's shift when the request was made (or last refreshed). */
  readonly requesterShift: AssignmentCode;
  readonly targetShift: ShiftCode | null;
  readonly counterpartId: string | null;
  /** Snapshot: the partner's shift when the request was made (or last refreshed). */
  readonly counterpartShift: AssignmentCode | null;
  readonly consent: SwapConsentStatus | null;
}

/** Both participants' shifts that day in the schedule's current working copy. */
export interface CurrentSwapCells {
  readonly requester: AssignmentCode | null;
  readonly counterpart: AssignmentCode | null;
}

/** Closing decisions on a request. Every one needs a pending request. */
export type ChangeRequestDecision = "CANCEL" | "REJECT" | "APPLY";

const DECISION_TARGETS = {
  CANCEL: "CANCELLED",
  REJECT: "REJECTED",
  APPLY: "APPLIED",
} as const satisfies Record<ChangeRequestDecision, ChangeRequestStatus>;

const notPending = (request: ChangeRequestState, attempted: string) =>
  err(new InvalidStateError(request.status, attempted, "the change request"));

/**
 * The status after a closing decision, or why it is refused. Only a pending
 * request can be cancelled (by its requester), rejected or applied (by the
 * Head Nurse); an applied request is final and never undone through the
 * request: a further correction is a new request or a new adjustment.
 * A swap is applied only with the partner's consent.
 */
export function decideChangeRequest(
  request: ChangeRequestState,
  decision: ChangeRequestDecision,
): Result<ChangeRequestStatus, InvalidStateError> {
  if (request.status !== "PENDING") return notPending(request, decision);
  if (
    decision === "APPLY" &&
    request.type === "SWAP" &&
    request.consent !== "ACCEPTED"
  )
    return err(
      new InvalidStateError(
        `CONSENT_${request.consent}`,
        CHANGE_REQUEST_REFUSALS.SWAP_CONSENT_REQUIRED,
        "the swap",
      ),
    );
  return ok(DECISION_TARGETS[decision]);
}

/** Whether either side of a swap differs from the shifts the request (and consent) were made against. */
export const swapContextChanged = (
  request: ChangeRequestState,
  current: CurrentSwapCells,
): boolean =>
  current.requester !== request.requesterShift ||
  current.counterpart !== request.counterpartShift;

const swapContextChangedError = (request: ChangeRequestState) =>
  err(
    new InvalidStateError(
      request.status,
      CHANGE_REQUEST_REFUSALS.SWAP_CONTEXT_CHANGED,
      "the swap",
    ),
  );

function checkPendingSwap(
  request: ChangeRequestState,
  attempted: string,
): Result<void, InvalidStateError> {
  if (request.type !== "SWAP")
    return err(
      new InvalidStateError(
        request.type,
        CHANGE_REQUEST_REFUSALS.NOT_A_SWAP,
        "the change request",
      ),
    );
  if (request.status !== "PENDING") return notPending(request, attempted);
  return ok(undefined);
}

/**
 * The swap partner's answer. Accepting consents to exactly the swap the
 * request describes, so it is refused when either side changed since
 * (the requester refreshes first). Declining closes the request as
 * REJECTED (by the partner). Answering twice is refused.
 */
export function respondToSwap(
  request: ChangeRequestState,
  input: { readonly accept: boolean; readonly current: CurrentSwapCells },
): Result<
  { status: ChangeRequestStatus; consent: SwapConsentStatus },
  InvalidStateError
> {
  const pending = checkPendingSwap(request, "RESPOND_TO_SWAP");
  if (!pending.ok) return pending;
  if (request.consent !== "PENDING")
    return err(
      new InvalidStateError(
        `CONSENT_${request.consent}`,
        CHANGE_REQUEST_REFUSALS.SWAP_ALREADY_ANSWERED,
        "the swap",
      ),
    );
  if (!input.accept) return ok({ status: "REJECTED", consent: "DECLINED" });
  if (swapContextChanged(request, input.current))
    return swapContextChangedError(request);
  return ok({ status: "PENDING", consent: "ACCEPTED" });
}

/**
 * The requester re-confirms a swap whose context changed: the snapshot
 * becomes both participants' current shifts and the partner's consent is
 * asked again (an earlier consent was for a different swap). Unchanged
 * context keeps the request as it is. A swap that no longer makes sense
 * (the requester is now off, or both have the same shift) cannot be
 * refreshed: cancel it and ask anew.
 */
export function refreshSwap(
  request: ChangeRequestState,
  current: CurrentSwapCells,
): Result<
  {
    requesterShift: AssignmentCode;
    counterpartShift: AssignmentCode | null;
    consent: SwapConsentStatus;
    changed: boolean;
  },
  ValidationError | InvalidStateError
> {
  const pending = checkPendingSwap(request, "REFRESH_SWAP");
  if (!pending.ok) return pending;
  if (!swapContextChanged(request, current))
    return ok({
      requesterShift: request.requesterShift,
      counterpartShift: request.counterpartShift,
      consent: request.consent!,
      changed: false,
    });
  if (current.requester === null)
    return invalid("You have no assignment on this day any more", "date");
  if (current.requester === current.counterpart)
    return invalid(
      "Both nurses now have the same shift; a swap would change nothing",
      "counterpartId",
    );
  return ok({
    requesterShift: current.requester,
    counterpartShift: current.counterpart,
    consent: "PENDING",
    changed: true,
  });
}

/** For `planRequestChange`: refuse a swap whose context changed. */
export const checkSwapContext = (
  request: ChangeRequestState,
  current: CurrentSwapCells,
): Result<void, InvalidStateError> =>
  swapContextChanged(request, current)
    ? swapContextChangedError(request)
    : ok(undefined);
