import { uniqueSortedDates, type IsoDate } from "../shared/dates";
import type { ScheduleStatus } from "./status";

/**
 * Which assignments a nurse sees for a schedule.
 *
 * - NONE: the schedule is still being planned (draft assignments are hidden).
 * - WORKING_COPY: finalized but never approved; shown as "pending approval".
 * - APPROVED_VERSION: the latest approved snapshot; dates under an in-progress
 *   revision are flagged as "change pending". Nurses never see unapproved edits
 *   to an approved schedule.
 */
export type NurseScheduleView =
  | { readonly source: "NONE" }
  | { readonly source: "WORKING_COPY"; readonly pendingApproval: true }
  | {
      readonly source: "APPROVED_VERSION";
      readonly pendingChangeDates: readonly IsoDate[];
    };

export interface NurseVisibilityContext {
  readonly status: ScheduleStatus;
  readonly hasApprovedVersion: boolean;
  /** Dates of the revision in progress, if any. */
  readonly revisionDates?: Iterable<IsoDate>;
}

export function nurseScheduleView(
  ctx: NurseVisibilityContext,
): NurseScheduleView {
  if (ctx.hasApprovedVersion) {
    // APPROVED shows no pending flags; REVISING and a revision's SUBMITTED/RETURNED do.
    const pending =
      ctx.status === "APPROVED"
        ? []
        : uniqueSortedDates(ctx.revisionDates ?? []);
    return { source: "APPROVED_VERSION", pendingChangeDates: pending };
  }
  switch (ctx.status) {
    case "FINALIZED":
    case "SUBMITTED":
    case "RETURNED":
      return { source: "WORKING_COPY", pendingApproval: true };
    default:
      return { source: "NONE" };
  }
}
