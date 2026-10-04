import { uniqueSortedDates, type IsoDate } from "../shared/dates";
import type { ScheduleStatus } from "./status";

/**
 * Which assignments a nurse sees of their own shifts in a schedule (D11 as
 * amended for the NICU pilot, D98). It never widens what anyone sees of
 * other nurses: callers read only the nurse's own cells.
 *
 * - WORKING_COPY: never approved yet, in every status from DRAFT on; the
 *   nurse sees their current working assignments, which may still change
 *   (how settled they are is `shiftPublication`'s concern).
 * - APPROVED_VERSION: the latest approved snapshot; dates under an
 *   in-progress revision are flagged as "change pending". Nurses never see
 *   unapproved edits to an approved schedule.
 */
export type NurseScheduleView =
  | { readonly source: "WORKING_COPY" }
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
  return { source: "WORKING_COPY" };
}
