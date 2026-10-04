import type { ScheduleStatus } from "./status";
import type { NurseScheduleView } from "./visibility";

/**
 * How settled the shifts a nurse sees are. Derived from what D11 (as amended,
 * D98) lets the nurse see (`nurseScheduleView`), never a second visibility
 * rule:
 *
 * - TEMPORARY: the working copy while the Head Nurse plans (DRAFT,
 *   PLANNING); any day may change.
 * - FINALIZED: the finalized working copy, not sent for approval yet; the
 *   Head Nurse may still correct it, no Supervisor approval is pending.
 * - RETURNED: the Supervisor returned it for corrections (first cycle); the
 *   Head Nurse is changing it, no approval is pending.
 * - AWAITING_APPROVAL: the working copy is with the Supervisor (SUBMITTED);
 *   frozen, but a return reopens it for changes.
 * - OFFICIAL: the latest approved version, immutable (D17). Later changes
 *   go through a revision and stay hidden until approved (D70); the revision's
 *   days are flagged as "change pending" by `nurseScheduleView`.
 */
export type ShiftPublication =
  "TEMPORARY" | "FINALIZED" | "RETURNED" | "AWAITING_APPROVAL" | "OFFICIAL";

export function shiftPublication(
  status: ScheduleStatus,
  view: NurseScheduleView,
): ShiftPublication {
  if (view.source === "APPROVED_VERSION") return "OFFICIAL";
  switch (status) {
    case "FINALIZED":
      return "FINALIZED";
    case "RETURNED":
      return "RETURNED";
    case "SUBMITTED":
      return "AWAITING_APPROVAL";
    case "DRAFT":
    case "PLANNING":
    // APPROVED and REVISING always have an approved version; should one ever
    // lack it, the working copy is shown as the most cautious reading.
    case "APPROVED":
    case "REVISING":
      return "TEMPORARY";
  }
}
