import type { AssignmentEdit } from "../schedule/assignment-editing";
import type { IsoDate } from "../shared/dates";
import { InvalidStateError, ValidationError } from "../shared/errors";
import { err, ok, type Result } from "../shared/result";
import type { ShiftCode } from "../shifts/shift-type";
import { CHANGE_REQUEST_REFUSALS } from "./model";
import { checkSwapContext, type ChangeRequestState } from "./request";

/** What the Head Nurse decides when applying a request. */
export interface RequestResolution {
  /**
   * UNAVAILABLE only: a nurse who takes over the requester's current shift
   * (must be on the roster and off that day). Omitted: nobody does.
   */
  readonly replacementNurseId?: string | null;
  /** OTHER only (required): the requester's resulting shift, null for off. */
  readonly requesterShift?: ShiftCode | null;
  /**
   * The Head Nurse saw that the requester's assignment changed since the
   * request and confirms the change against the current one.
   */
  readonly confirmStaleContext?: boolean;
}

/** The current working-copy shifts of the cells a request touches. */
export interface CurrentRequestCells {
  readonly requester: ShiftCode | null;
  /** SWAP: the partner's current shift. */
  readonly counterpart: ShiftCode | null;
  /** UNAVAILABLE with a replacement: the replacement's current shift. */
  readonly replacement: ShiftCode | null;
}

/** The requester's assignment differs from the one the request was made against. */
export interface StaleRequestContext {
  readonly nurseId: string;
  readonly date: IsoDate;
  readonly requestedAgainst: ShiftCode | null;
  readonly current: ShiftCode | null;
}

export interface RequestChangePlan {
  /** Only cells that actually change, computed from the current working copy. */
  readonly edits: readonly AssignmentEdit[];
  /** Set when the context changed (a soft warning the Head Nurse must confirm). */
  readonly stale: StaleRequestContext | null;
}

const invalid = (message: string, field: string) =>
  err(new ValidationError(message, field));

/**
 * The schedule change a request leads to, always computed against the
 * schedule's CURRENT working copy, never the snapshot the nurse saw:
 *
 * - UNAVAILABLE: the requester gets no shift; an optional replacement (off
 *   that day) takes over the requester's current shift.
 * - CHANGE_SHIFT: the requester gets the requested shift.
 * - OTHER: the requester gets what the Head Nurse decides.
 * - SWAP: the two nurses exchange their current shifts. Refused when either
 *   side changed since the request/consent (`SWAP_CONTEXT_CHANGED`): the
 *   requester must refresh and the partner consent again.
 *
 * For the other types a changed context is reported in `stale` (a soft
 * warning); `confirmRequestPlan` then needs the Head Nurse's confirmation.
 * Consent and status are `decideChangeRequest`'s job; scheduling rules are
 * assessed on the result (`assessChange`).
 */
export function planRequestChange(input: {
  readonly request: ChangeRequestState;
  readonly current: CurrentRequestCells;
  readonly rosterNurseIds: ReadonlySet<string>;
  readonly resolution: RequestResolution;
}): Result<RequestChangePlan, ValidationError | InvalidStateError> {
  const { request, current, resolution } = input;
  const { date, requesterId } = request;
  const replacementId = resolution.replacementNurseId ?? null;

  if (replacementId !== null && request.type !== "UNAVAILABLE")
    return invalid(
      "Only an unavailability names a replacement",
      "replacementNurseId",
    );
  if (resolution.requesterShift !== undefined && request.type !== "OTHER")
    return invalid(
      "The resulting shift is decided by the request",
      "requesterShift",
    );

  const edits: AssignmentEdit[] = [];
  const edit = (nurseId: string, shift: ShiftCode | null) =>
    edits.push({ nurseId, date, shift });

  switch (request.type) {
    case "SWAP": {
      const fresh = checkSwapContext(request, current);
      if (!fresh.ok) return fresh;
      edit(requesterId, current.counterpart);
      edit(request.counterpartId!, current.requester);
      return ok({ edits, stale: null });
    }
    case "UNAVAILABLE":
      edit(requesterId, null);
      if (replacementId !== null) {
        if (
          replacementId === requesterId ||
          !input.rosterNurseIds.has(replacementId)
        )
          return invalid(
            "The replacement must be another nurse on the roster",
            "replacementNurseId",
          );
        if (current.replacement !== null)
          return invalid(
            "The replacement already works that day",
            "replacementNurseId",
          );
        if (current.requester === null)
          return invalid(
            "There is no shift for a replacement to take over",
            "replacementNurseId",
          );
        edit(replacementId, current.requester);
      }
      break;
    case "CHANGE_SHIFT":
      edit(requesterId, request.targetShift);
      break;
    case "OTHER":
      if (resolution.requesterShift === undefined)
        return invalid(
          "Decide the requester's resulting shift",
          "requesterShift",
        );
      edit(requesterId, resolution.requesterShift);
      break;
  }

  const stale =
    current.requester === request.requesterShift
      ? null
      : {
          nurseId: requesterId,
          date,
          requestedAgainst: request.requesterShift,
          current: current.requester,
        };
  const currentOf = (nurseId: string) =>
    nurseId === requesterId ? current.requester : current.replacement;
  return ok({
    edits: edits.filter((e) => e.shift !== currentOf(e.nurseId)),
    stale,
  });
}

/**
 * The gate before applying a planned request: a changed context needs the
 * Head Nurse's explicit confirmation, and a plan that changes nothing (the
 * schedule already reflects it) is refused: reject the request instead.
 */
export function confirmRequestPlan(
  plan: RequestChangePlan,
  resolution: RequestResolution,
): Result<readonly AssignmentEdit[], ValidationError | InvalidStateError> {
  if (plan.stale && !resolution.confirmStaleContext)
    return err(
      new InvalidStateError(
        "STALE",
        CHANGE_REQUEST_REFUSALS.STALE_CONTEXT_NOT_CONFIRMED,
        "the request context",
      ),
    );
  if (plan.edits.length === 0)
    return invalid(
      "The schedule already reflects this request; nothing would change",
      "request",
    );
  return ok(plan.edits);
}
