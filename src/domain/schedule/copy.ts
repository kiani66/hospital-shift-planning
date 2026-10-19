import { conflictsWithPreference } from "../preferences/preference-alignment";
import type { StaffingRequirement } from "../rules/staffing";
import { staffingImpact } from "../rules/assess-change";
import {
  addDays,
  daysBetween,
  uniqueSortedDates,
  type IsoDate,
} from "../shared/dates";
import { ValidationError } from "../shared/errors";
import { isInPeriod, type DatePeriod } from "../shared/period";
import type { Assignment } from "../shifts/assignment";
import type { PreferenceValue } from "../shifts/shift-type";
import { assessEdits } from "./assess-edits";
import {
  assignmentKey,
  canEditAssignment,
  type AssignmentEditContext,
} from "./assignment-editing";

/** Whole monthly periods map their ordinal day (Jalali day number at the UI boundary). */
export type CopyScope =
  | { readonly mode: "MONTH" }
  | {
      readonly mode: "DAY";
      readonly sourceDate: IsoDate;
      readonly targetDate: IsoDate;
    }
  | {
      readonly mode: "RANGE";
      readonly sourceStart: IsoDate;
      readonly sourceEnd: IsoDate;
      readonly targetStart: IsoDate;
    };
export type CopyReason =
  | "TARGET_DATE_DOES_NOT_EXIST"
  | "NURSE_NOT_IN_TARGET_ROSTER"
  | "NOT_ELIGIBLE_ON_TARGET_DATE"
  | "SOURCE_LEAVE_NOT_COPIED"
  | "TARGET_ASSIGNMENT_ALREADY_EXISTS"
  | "LEAVE_CONFLICT"
  | "TARGET_SCHEDULE_NOT_EDITABLE"
  | "DATE_OUTSIDE_REVISION_SCOPE";
export interface CopyRow {
  readonly nurseId: string;
  readonly sourceDate: IsoDate;
  readonly targetDate: IsoDate | null;
  readonly shift: Assignment["shift"];
  readonly outcome: "CREATE" | "UNCHANGED" | "SKIP" | "CONFLICT";
  readonly reason: CopyReason | null;
}
export interface CopySelection {
  readonly nurseIds?: readonly string[];
  /** Assignments have a composite identity; there is no assignment UUID. */
  readonly sourceCells?: readonly {
    readonly nurseId: string;
    readonly date: IsoDate;
  }[];
}

export function mapCopyDates(
  scope: CopyScope,
  source: DatePeriod,
  target: DatePeriod,
) {
  const start =
    scope.mode === "MONTH"
      ? source.start
      : scope.mode === "DAY"
        ? scope.sourceDate
        : scope.sourceStart;
  const end =
    scope.mode === "MONTH"
      ? source.end
      : scope.mode === "DAY"
        ? scope.sourceDate
        : scope.sourceEnd;
  const targetStart =
    scope.mode === "MONTH"
      ? target.start
      : scope.mode === "DAY"
        ? scope.targetDate
        : scope.targetStart;
  if (!isInPeriod(source, start) || !isInPeriod(source, end) || end < start)
    throw new ValidationError("Invalid source date range", "scope");
  if (!isInPeriod(target, targetStart))
    throw new ValidationError("Invalid target start date", "scope");
  const mapping = new Map<IsoDate, IsoDate | null>();
  for (let i = 0; i <= daysBetween(start, end); i++) {
    const date = addDays(targetStart, i);
    // Never roll an excess day into the next schedule/month.
    mapping.set(addDays(start, i), isInPeriod(target, date) ? date : null);
  }
  return mapping;
}

/** Stable, side-effect-free plan; the entire proposed batch is assessed together. */
export function planScheduleCopy(input: {
  readonly scope: CopyScope;
  readonly selection: CopySelection;
  readonly source: {
    readonly departmentId: string;
    readonly period: DatePeriod;
    readonly assignments: readonly Assignment[];
  };
  readonly target: Omit<AssignmentEditContext, "date"> & {
    readonly departmentId: string;
    readonly assignments: readonly Assignment[];
  };
  readonly rosterNurseIds: ReadonlySet<string>;
  readonly eligibleCells: ReadonlySet<string>;
  readonly preferences: ReadonlyMap<string, PreferenceValue>;
  readonly adjacentAssignments: readonly Assignment[];
  readonly staffingNurseIds: readonly string[];
  readonly staffingRequirements: ReadonlyMap<IsoDate, StaffingRequirement>;
}) {
  const { source, target, selection } = input;
  if (source.departmentId !== target.departmentId)
    throw new ValidationError(
      "Copy requires the same department",
      "sourceScheduleId",
      "CROSS_DEPARTMENT_COPY",
    );
  const mapping = mapCopyDates(input.scope, source.period, target.period);
  const selectedCells = selection.sourceCells
    ? new Set(
        selection.sourceCells.map((c) => assignmentKey(c.nurseId, c.date)),
      )
    : null;
  const selected = source.assignments
    .filter(
      (a) =>
        mapping.has(a.date) &&
        (!selection.nurseIds || selection.nurseIds.includes(a.nurseId)) &&
        (!selectedCells || selectedCells.has(assignmentKey(a.nurseId, a.date))),
    )
    .toSorted(
      (a, b) =>
        a.date.localeCompare(b.date) || a.nurseId.localeCompare(b.nurseId),
    );
  const current = new Map(
    target.assignments.map((a) => [assignmentKey(a.nurseId, a.date), a.shift]),
  );
  const rows: CopyRow[] = selected.map((a) => {
    const targetDate = mapping.get(a.date)!;
    const row = {
      nurseId: a.nurseId,
      sourceDate: a.date,
      targetDate,
      shift: a.shift,
    };
    const skip = (reason: CopyReason): CopyRow => ({
      ...row,
      outcome: "SKIP",
      reason,
    });
    if (a.shift === "H") return skip("SOURCE_LEAVE_NOT_COPIED");
    if (!targetDate) return skip("TARGET_DATE_DOES_NOT_EXIST");
    if (!input.rosterNurseIds.has(a.nurseId))
      return skip("NURSE_NOT_IN_TARGET_ROSTER");
    const editable = canEditAssignment({ ...target, date: targetDate });
    if (!editable.allowed)
      return {
        ...row,
        outcome: "CONFLICT",
        reason:
          editable.reason === "DATE_OUTSIDE_REVISION_SCOPE"
            ? editable.reason
            : "TARGET_SCHEDULE_NOT_EDITABLE",
      };
    const key = assignmentKey(a.nurseId, targetDate);
    if (!input.eligibleCells.has(key))
      return skip("NOT_ELIGIBLE_ON_TARGET_DATE");
    const existing = current.get(key);
    if (existing !== undefined)
      return {
        ...row,
        outcome: existing === a.shift ? "UNCHANGED" : "CONFLICT",
        reason:
          existing === "H"
            ? "LEAVE_CONFLICT"
            : "TARGET_ASSIGNMENT_ALREADY_EXISTS",
      };
    return { ...row, outcome: "CREATE", reason: null };
  });
  const proposed: Assignment[] = rows
    .filter((r) => r.outcome === "CREATE")
    .map((r) => ({ nurseId: r.nurseId, date: r.targetDate!, shift: r.shift }));
  const { after, assessment } = assessEdits({
    period: target.period,
    assignments: target.assignments,
    edits: proposed,
    adjacentAssignments: input.adjacentAssignments,
    staffingRequirements: input.staffingRequirements,
    staffingNurseIds: input.staffingNurseIds,
  });
  const preferenceNotes = proposed
    .filter((a) =>
      conflictsWithPreference({
        preference:
          input.preferences.get(assignmentKey(a.nurseId, a.date)) ?? null,
        shift: a.shift,
      }),
    )
    .map((a) => ({ ...a, reason: "TARGET_PREFERENCE_DIFFERS" as const }));
  const targetDates = uniqueSortedDates(
    [...mapping.values()].filter((d) => d !== null),
  );
  return {
    sourceAssignmentCount: selected.length,
    rows,
    proposed,
    unchangedCount: rows.filter((r) => r.outcome === "UNCHANGED").length,
    skippedCount: rows.filter((r) => r.outcome === "SKIP").length,
    conflictCount: rows.filter((r) => r.outcome === "CONFLICT").length,
    targetDates,
    affectedNurseIds: [...new Set(proposed.map((a) => a.nurseId))].sort(),
    assessment,
    preferenceNotes,
    canApply: proposed.length > 0 && !assessment.blocked,
    coverage: staffingImpact({
      before: target.assignments,
      after,
      dates: targetDates,
      requirements: input.staffingRequirements,
      staffingNurseIds: input.staffingNurseIds,
    }),
  };
}
export type ScheduleCopyPlan = ReturnType<typeof planScheduleCopy>;
