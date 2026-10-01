import type { ScheduleStatus } from "../schedule/status";

/**
 * Shift Change Requests (Phase 9). After finalization, preferences are closed
 * for good; a nurse who needs a change asks for it with a structured request,
 * and only the Head Nurse changes the schedule (applying the request, or
 * rejecting it). The request and the schedule change it leads to are two
 * separate, audited facts.
 */

export const CHANGE_REQUEST_TYPES = [
  /** The nurse cannot work their assigned shift that day. */
  "UNAVAILABLE",
  /** A different shift on the same day. */
  "CHANGE_SHIFT",
  /** Exchange the day's assignment with another nurse (same day, same schedule). */
  "SWAP",
  /** Anything else; the Head Nurse decides the resulting change. */
  "OTHER",
] as const;

export type ChangeRequestType = (typeof CHANGE_REQUEST_TYPES)[number];

/**
 * PENDING    waiting for the Head Nurse (and, for a swap, the other nurse)
 * CANCELLED  withdrawn by the requester while pending
 * REJECTED   rejected by the Head Nurse, or the swap partner declined
 * APPLIED    the Head Nurse applied the change to the schedule (final)
 */
export const CHANGE_REQUEST_STATUSES = [
  "PENDING",
  "CANCELLED",
  "REJECTED",
  "APPLIED",
] as const;

export type ChangeRequestStatus = (typeof CHANGE_REQUEST_STATUSES)[number];

/**
 * Only a pending request is active: one nurse has at most one active request
 * per schedule and day. Closed requests stay as history.
 */
export const isActiveChangeRequest = (status: ChangeRequestStatus): boolean =>
  status === "PENDING";

/** The swap partner's answer; a swap is never applied without ACCEPTED. */
export const SWAP_CONSENT_STATUSES = [
  "PENDING",
  "ACCEPTED",
  "DECLINED",
] as const;

export type SwapConsentStatus = (typeof SWAP_CONSENT_STATUSES)[number];

/** Who closed a rejected request. */
export const CHANGE_REQUEST_REJECTIONS = [
  "HEAD_NURSE",
  "COUNTERPART_DECLINED",
] as const;

export type ChangeRequestRejection = (typeof CHANGE_REQUEST_REJECTIONS)[number];

/** Schedule statuses that accept new change requests: from FINALIZED on (D13). */
export const CHANGE_REQUEST_SCHEDULE_STATUSES: readonly ScheduleStatus[] = [
  "FINALIZED",
  "SUBMITTED",
  "RETURNED",
  "APPROVED",
  "REVISING",
];

export const acceptsChangeRequests = (status: ScheduleStatus): boolean =>
  CHANGE_REQUEST_SCHEDULE_STATUSES.includes(status);

/**
 * `InvalidStateError.attempted` values of refused change-request operations
 * (stable and machine-readable; the UI words them).
 */
export const CHANGE_REQUEST_REFUSALS = {
  /** The schedule is not finalized yet (preferences are the way to ask). */
  SCHEDULE_NOT_ACCEPTING: "CREATE_CHANGE_REQUEST",
  /** A swap needs the partner's consent before it can be applied. */
  SWAP_CONSENT_REQUIRED: "APPLY_SWAP_WITHOUT_CONSENT",
  /** Either side of the swap changed since the request/consent: refresh and re-consent. */
  SWAP_CONTEXT_CHANGED: "SWAP_CONTEXT_CHANGED",
  /** The partner already answered. */
  SWAP_ALREADY_ANSWERED: "SWAP_CONSENT_ALREADY_ANSWERED",
  /** Consent and refresh exist only for swaps. */
  NOT_A_SWAP: "SWAP_ONLY",
  /** The assignment changed since the request; the Head Nurse must confirm the current one. */
  STALE_CONTEXT_NOT_CONFIRMED: "STALE_CONTEXT_NOT_CONFIRMED",
} as const;
