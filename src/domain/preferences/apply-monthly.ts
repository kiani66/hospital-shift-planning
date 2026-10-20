import type { IsoDate } from "../shared/dates";
import { isInPeriod, type DatePeriod } from "../shared/period";
import { unwrap } from "../shared/result";
import type { Assignment } from "../shifts/assignment";
import type { PreferenceValue } from "../shifts/shift-type";
import {
  assignmentKey,
  planAssignmentEdits,
  type AssignmentEdit,
} from "../schedule/assignment-editing";

export type PreferenceSkipReason =
  | "OUTSIDE_PERIOD"
  | "NOT_ON_ROSTER"
  | "INACTIVE_OR_NOT_MEMBER"
  | "LEAVE_PRESERVED";

/** Current preference cells are the entire replacement scope; no import cursor. */
export function planMonthlyPreferences(input: {
  readonly status: "DRAFT" | "PLANNING";
  readonly period: DatePeriod;
  readonly preferences: readonly {
    userId: string;
    date: IsoDate;
    value: PreferenceValue;
  }[];
  readonly assignments: readonly Assignment[];
  readonly rosterNurseIds: ReadonlySet<string>;
  readonly members: readonly {
    userId: string;
    isActive: boolean;
    startedOn: IsoDate;
    endedOn: IsoDate | null;
  }[];
}) {
  const current = new Map(
    input.assignments.map((a) => [assignmentKey(a.nurseId, a.date), a.shift]),
  );
  const skipped: {
    nurseId: string;
    date: IsoDate;
    reason: PreferenceSkipReason;
  }[] = [];
  const edits: AssignmentEdit[] = [];
  for (const p of input.preferences) {
    const reason: PreferenceSkipReason | null = !isInPeriod(
      input.period,
      p.date,
    )
      ? "OUTSIDE_PERIOD"
      : !input.rosterNurseIds.has(p.userId)
        ? "NOT_ON_ROSTER"
        : !input.members.some(
              (m) =>
                m.userId === p.userId &&
                m.isActive &&
                m.startedOn <= p.date &&
                (m.endedOn === null || m.endedOn >= p.date),
            )
          ? "INACTIVE_OR_NOT_MEMBER"
          : current.get(assignmentKey(p.userId, p.date)) === "H"
            ? "LEAVE_PRESERVED"
            : null;
    if (reason) skipped.push({ nurseId: p.userId, date: p.date, reason });
    else edits.push({ nurseId: p.userId, date: p.date, shift: p.value });
  }
  const changes = edits.length
    ? unwrap(
        planAssignmentEdits({
          edits,
          current,
          rosterNurseIds: input.rosterNurseIds,
          schedule: {
            status: input.status,
            period: input.period,
            revisionDates: null,
          },
        }),
      )
    : [];
  return { changes, skipped, unchangedCount: edits.length - changes.length };
}
