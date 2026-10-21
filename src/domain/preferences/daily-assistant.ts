import type { MembershipRole } from "../authz/actor";
import type { ChangeAssessment } from "../rules/assess-change";
import { bucketCoverage } from "../rules/staffing";
import { validateSchedule } from "../rules/validate-schedule";
import { assessEdits } from "../schedule/assess-edits";
import { assignmentKey } from "../schedule/assignment-editing";
import type { IsoDate } from "../shared/dates";
import { ValidationError } from "../shared/errors";
import { isInPeriod, type DatePeriod } from "../shared/period";
import type { Assignment } from "../shifts/assignment";
import { countByShift, coverageOf } from "../shifts/coverage";
import {
  COVERAGE_PERIODS,
  SHIFT_CODES,
  SHIFT_TYPES,
  type AssignmentCode,
  type BaseShift,
  type PreferenceValue,
  type ShiftCode,
} from "../shifts/shift-type";
import type { RuleSetContent } from "../staffing-rules/model";
import { resolveDay, resolveRequirements } from "../staffing-rules/resolve";

export interface DailyPreferencePlanInput {
  readonly date: IsoDate;
  readonly period: DatePeriod;
  /** May contain other days; only the selected day's preferences are returned. */
  readonly preferences: readonly {
    readonly userId: string;
    readonly date: IsoDate;
    readonly value: PreferenceValue;
  }[];
  readonly assignments: readonly Assignment[];
  readonly roster: readonly {
    readonly userId: string;
    readonly role: MembershipRole;
  }[];
  /** Memberships of this department, not the actor's current-day memberships. */
  readonly members: readonly {
    readonly userId: string;
    readonly isActive: boolean;
    readonly role: MembershipRole;
    readonly startedOn: IsoDate;
    readonly endedOn: IsoDate | null;
  }[];
  /** The caller loads the schedule's pin; the planner never selects a newer version. */
  readonly staffingRuleSet: {
    readonly versionId: string;
    readonly content: RuleSetContent;
  };
  readonly holidays: ReadonlySet<IsoDate>;
  /** Both external boundary days for ALL suggested nurses, even without current assignments. */
  readonly adjacentAssignments: readonly Assignment[];
  /** Ephemeral bulk exclusions; never used to reduce capacity demand or stored by this planner. */
  readonly excludedNurseIds?: ReadonlySet<string>;
}

/** Stable translation keys; Persian text belongs in the presentation adapter. */
export type DailyPreferenceReason =
  | "OFF_PREFERENCE"
  | "NON_NURSING_PREFERENCE"
  | "NOT_ON_ROSTER"
  | "INACTIVE_OR_NOT_MEMBER"
  | "EXISTING_ASSIGNMENT"
  | "RULE_VIOLATION";

export interface DailyPreferenceSuggestion {
  readonly nurseId: string;
  readonly date: IsoDate;
  readonly preference: PreferenceValue;
  readonly currentAssignment: AssignmentCode | null;
  readonly status:
    "ELIGIBLE" | "ALREADY_ASSIGNED" | "CONFLICT" | "INFORMATIONAL";
  readonly reason: DailyPreferenceReason | null;
  /** Hypothetical single insertion; null when no insertion is offered. */
  readonly assessment: ChangeAssessment | null;
}

export interface DailyPreferenceGroupSkip {
  readonly shift: ShiftCode;
  readonly reason:
    | "CAPACITY_CONTENTION"
    | "NO_ELIGIBLE_SUGGESTIONS"
    | "SESSION_EXCLUDED"
    | "BATCH_RULE_CONFLICT";
  readonly contentionPeriods: readonly BaseShift[];
}

// Code-unit identity order, never locale or priority order. It cannot choose a capacity winner.
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Pure, insertion-only daily advice. Authorization, DRAFT/PLANNING gating, fresh
 * reads, locking and persistence belong to the later application command.
 * All capacity decisions precede session exclusions; no nurse or shift wins by order.
 */
export function planDailyPreferences(input: DailyPreferencePlanInput) {
  const { date, period } = input;
  if (!isInPeriod(period, date))
    throw new ValidationError(
      "The date is outside the schedule period",
      "date",
    );

  // Reject ambiguous cell state using the existing structural validator. Other
  // existing findings remain valid planning context for assessEdits.
  if (
    validateSchedule({ period, assignments: input.assignments }).some(
      (v) => v.rule === "DUPLICATE_ASSIGNMENT" || v.rule === "OUTSIDE_PERIOD",
    )
  )
    throw new ValidationError("Invalid assignment structure", "assignments");
  const roster = new Map(input.roster.map((r) => [r.userId, r.role]));
  if (roster.size !== input.roster.length)
    throw new ValidationError("Duplicate roster member", "roster");
  const preferences = input.preferences
    .filter((p) => p.date === date)
    .toSorted((a, b) => compare(a.userId, b.userId));
  if (new Set(preferences.map((p) => p.userId)).size !== preferences.length)
    throw new ValidationError("Duplicate daily preference", "preferences");

  const assignments = input.assignments.toSorted(
    (a, b) => compare(a.date, b.date) || compare(a.nurseId, b.nurseId),
  );
  const current = new Map(
    assignments.map((a) => [assignmentKey(a.nurseId, a.date), a.shift]),
  );
  const staffingNurseIds = input.roster
    .filter((r) => r.role !== "SECRETARY")
    .map((r) => r.userId);
  const requirements = resolveRequirements(
    input.staffingRuleSet.content,
    [date],
    input.holidays,
  );
  const resolved = resolveDay(
    input.staffingRuleSet.content,
    date,
    input.holidays.has(date),
  );
  const assess = (edits: readonly Assignment[]) =>
    assessEdits({
      period,
      assignments,
      edits,
      staffingNurseIds,
      staffingRequirements: requirements,
      adjacentAssignments: input.adjacentAssignments,
    }).assessment;

  // Includes capacity-only refusals (e.g. maximum zero), but excludes nurses
  // blocked by rest/eligibility/existing decisions. No rule is reimplemented here.
  const demandNurseIds = new Set<string>();
  const rows: DailyPreferenceSuggestion[] = preferences.map((p) => {
    const row = {
      nurseId: p.userId,
      date,
      preference: p.value,
      currentAssignment: current.get(assignmentKey(p.userId, date)) ?? null,
    };
    const result = (
      status: DailyPreferenceSuggestion["status"],
      reason: DailyPreferenceReason | null,
      assessment: ChangeAssessment | null = null,
    ): DailyPreferenceSuggestion => ({ ...row, status, reason, assessment });
    if (p.value === "OFF") return result("INFORMATIONAL", "OFF_PREFERENCE");
    const members = input.members.filter(
      (m) =>
        m.userId === p.userId &&
        m.isActive &&
        m.startedOn <= date &&
        (m.endedOn === null || m.endedOn >= date),
    );
    if (
      roster.get(p.userId) === "SECRETARY" ||
      (members.length > 0 && members.every((m) => m.role === "SECRETARY"))
    )
      return result("INFORMATIONAL", "NON_NURSING_PREFERENCE");
    if (row.currentAssignment === p.value)
      return result("ALREADY_ASSIGNED", null);
    if (row.currentAssignment !== null)
      return result("CONFLICT", "EXISTING_ASSIGNMENT");
    if (!roster.has(p.userId)) return result("CONFLICT", "NOT_ON_ROSTER");
    if (members.length === 0)
      return result("CONFLICT", "INACTIVE_OR_NOT_MEMBER");
    const assessment = assess([{ nurseId: p.userId, date, shift: p.value }]);
    if (
      assessment.blocking.every(
        (v) => v.rule === "STAFFING" && v.status === "ABOVE_MAXIMUM",
      )
    )
      demandNurseIds.add(p.userId);
    return result(
      assessment.blocked ? "CONFLICT" : "ELIGIBLE",
      assessment.blocked ? "RULE_VIOLATION" : null,
      assessment,
    );
  });
  const coverageOfRows = (selected: readonly DailyPreferenceSuggestion[]) =>
    coverageOf(countByShift(selected.map((r) => r.preference)));
  const demand = coverageOfRows(
    rows.filter((r) => demandNurseIds.has(r.nurseId)),
  );
  const currentCoverage = coverageOf(
    countByShift(
      assignments
        .filter((a) => a.date === date && staffingNurseIds.includes(a.nurseId))
        .map((a) => a.shift),
    ),
  );
  const contended = COVERAGE_PERIODS.filter((p) => {
    const maximum = resolved[p].max;
    return (
      maximum !== null &&
      demand[p] > 0 &&
      currentCoverage[p] + demand[p] > maximum
    );
  });
  const skippedGroups: DailyPreferenceGroupSkip[] = [];
  const groups = SHIFT_CODES.map((shift) => {
    const suggestions = rows.filter((r) => r.preference === shift);
    const contentionPeriods = suggestions.some((r) =>
      demandNurseIds.has(r.nurseId),
    )
      ? contended.filter((p) => SHIFT_TYPES[shift].covers.includes(p))
      : [];
    const eligible = suggestions.filter((r) => r.status === "ELIGIBLE");
    const reason = contentionPeriods.length
      ? "CAPACITY_CONTENTION"
      : eligible.length === 0
        ? "NO_ELIGIBLE_SUGGESTIONS"
        : eligible.every((r) => input.excludedNurseIds?.has(r.nurseId))
          ? "SESSION_EXCLUDED"
          : null;
    if (reason) skippedGroups.push({ shift, reason, contentionPeriods });
    return {
      shift,
      suggestions,
      manualSelectionRequired: reason === "CAPACITY_CONTENTION",
    };
  });
  let proposed: Assignment[] = groups
    .filter((g) => !skippedGroups.some((s) => s.shift === g.shift))
    .flatMap((g) => g.suggestions)
    .filter(
      (r) => r.status === "ELIGIBLE" && !input.excludedNurseIds?.has(r.nurseId),
    )
    .map((r) => ({
      nurseId: r.nurseId,
      date,
      shift: r.preference as ShiftCode,
    }));
  const assessment = assess(proposed);
  if (assessment.blocked) {
    // Fail the complete attempted batch closed; never salvage a first-fitting
    // subset if a present or future shared rule finds an aggregate conflict.
    for (const group of groups)
      if (proposed.some((a) => a.shift === group.shift))
        skippedGroups.push({
          shift: group.shift,
          reason: "BATCH_RULE_CONFLICT",
          contentionPeriods: [],
        });
    proposed = [];
  }
  const added = coverageOf(countByShift(proposed.map((a) => a.shift)));
  return {
    date,
    staffingRuleSetVersionId: input.staffingRuleSet.versionId,
    groups,
    offPreferences: rows.filter((r) => r.preference === "OFF"),
    proposed,
    skippedGroups: skippedGroups.toSorted(
      (a, b) => SHIFT_CODES.indexOf(a.shift) - SHIFT_CODES.indexOf(b.shift),
    ),
    /** On failure this describes the refused attempted batch; proposed is empty. */
    assessment,
    coverage: COVERAGE_PERIODS.map((p) => {
      const bounds = requirements.get(date)![p]!;
      const before = bucketCoverage(currentCoverage[p], bounds);
      const after = bucketCoverage(currentCoverage[p] + added[p], bounds);
      return {
        period: p,
        source: resolved[p].source,
        current: currentCoverage[p],
        minimum: resolved[p].min,
        maximum: resolved[p].max,
        eligibleDemand: demand[p],
        availableCapacity:
          resolved[p].max === null
            ? null
            : Math.max(0, resolved[p].max - currentCoverage[p]),
        contention: contended.includes(p),
        currentShortage: before.status === "BELOW_MINIMUM" ? before.gap : 0,
        proposed: currentCoverage[p] + added[p],
        remainingShortage: after.status === "BELOW_MINIMUM" ? after.gap : 0,
      };
    }),
  };
}

export type DailyPreferencePlan = ReturnType<typeof planDailyPreferences>;
