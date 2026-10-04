import type { MembershipRole } from "../authz/actor";
import type { IsoDate } from "../shared/dates";
import { InvalidStateError } from "../shared/errors";
import { err, ok, type Result } from "../shared/result";
import type { DatePeriod } from "../shared/period";
import type { ScheduleStatus } from "./status";

/**
 * Explicit roster additions (D21 amended by the draft-roster decision): only
 * before finalization. FINALIZED and later schedules (and every approved
 * version) keep their roster; later joiners there go through the normal
 * revision/adjustment workflows, never a silent roster change.
 */
export const ROSTER_EDITABLE_STATUSES: readonly ScheduleStatus[] = [
  "DRAFT",
  "PLANNING",
];

export const ADD_TO_ROSTER = "ADD_TO_ROSTER";

export function checkRosterEditable(
  status: ScheduleStatus,
): Result<void, InvalidStateError> {
  return ROSTER_EDITABLE_STATUSES.includes(status)
    ? ok(undefined)
    : err(new InvalidStateError(status, ADD_TO_ROSTER));
}

export interface PeriodMembership {
  readonly role: MembershipRole;
  readonly startedOn: IsoDate;
  readonly endedOn: IsoDate | null;
}

/**
 * The roster role of a department member for a schedule period, with the same
 * rule as the creation snapshot (D19): eligible when a membership is in effect
 * on at least one day of the period; with several (e.g. promoted mid-period)
 * the latest-starting one decides. Null when not eligible.
 */
export function rosterRoleForPeriod(
  memberships: readonly PeriodMembership[],
  period: DatePeriod,
): MembershipRole | null {
  const overlapping = memberships
    .filter(
      (m) =>
        m.startedOn <= period.end &&
        (m.endedOn === null || m.endedOn >= period.start),
    )
    .sort((a, b) => (a.startedOn < b.startedOn ? 1 : -1));
  return overlapping[0]?.role ?? null;
}
