import type { ScheduleStatus } from "./status";
import type { NurseScheduleView } from "./visibility";

/**
 * How settled the shifts a nurse sees are. Derived from what D11 lets the
 * nurse see (`nurseScheduleView`), never a second visibility rule:
 *
 * - NOT_PUBLISHED: still being planned (DRAFT, PLANNING); assignments stay
 *   hidden, only the status is shown.
 * - TEMPORARY: the finalized working copy, not sent for approval yet
 *   (FINALIZED, or RETURNED by the Supervisor); the Head Nurse may still
 *   change any day.
 * - AWAITING_APPROVAL: the working copy is with the Supervisor (SUBMITTED);
 *   frozen, but a return reopens it for changes.
 * - OFFICIAL: the latest approved version, immutable (D17). Later changes
 *   go through a revision and stay hidden until approved (D70); the revision's
 *   days are flagged as "change pending" by `nurseScheduleView`.
 */
export type ShiftPublication =
  "NOT_PUBLISHED" | "TEMPORARY" | "AWAITING_APPROVAL" | "OFFICIAL";

/** The publication states whose shifts a nurse sees. */
export type VisibleShiftPublication = Exclude<
  ShiftPublication,
  "NOT_PUBLISHED"
>;

export function shiftPublication(
  status: ScheduleStatus,
  view: NurseScheduleView,
): ShiftPublication {
  switch (view.source) {
    case "NONE":
      return "NOT_PUBLISHED";
    case "APPROVED_VERSION":
      return "OFFICIAL";
    case "WORKING_COPY":
      return status === "SUBMITTED" ? "AWAITING_APPROVAL" : "TEMPORARY";
  }
}
