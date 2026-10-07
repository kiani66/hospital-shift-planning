import { assessChange, type ChangeAssessment } from "../rules/assess-change";
import type { StaffingRequirement } from "../rules/staffing";
import { validateSchedule } from "../rules/validate-schedule";
import type { IsoDate } from "../shared/dates";
import type { DatePeriod } from "../shared/period";
import type { Assignment } from "../shifts/assignment";
import type { AssignmentEdit } from "./assignment-editing";
import { applyAssignmentEdits } from "./schedule-change";

export interface EditsAssessmentInput {
  readonly period: DatePeriod;
  /** The schedule's working copy before the edits. Never modified. */
  readonly assignments: readonly Assignment[];
  /** The cells to change (null clears); already planned, so each changes its cell. */
  readonly edits: readonly AssignmentEdit[];
  /**
   * The neighbouring schedules' assignments (already loaded), the context
   * night rest needs across the period boundary (D7, D20). Passed to the
   * validator as it is, which keeps only the boundary days.
   */
  readonly adjacentAssignments?: readonly Assignment[];
  /** The pinned rule-set version's bounds for the days to check (D106). */
  readonly staffingRequirements?: ReadonlyMap<IsoDate, StaffingRequirement>;
}

export interface EditsAssessment {
  /** The working copy after the edits (a new list). */
  readonly after: readonly Assignment[];
  readonly assessment: ChangeAssessment;
}

/**
 * The hard-rule assessment of a hypothetical change, without persistence:
 * applies `edits` to a copy of the working copy, validates before and after
 * with the same context, and reports what the change introduces, worsens or
 * keeps on the changed cells (`assessChange`, D69, D102). One pure core for
 * every caller that must not let a change introduce a hard violation, so a
 * preview and the write that follows it evaluate the same rules (D111).
 *
 * Completeness (UNDECIDED) is deliberately not part of it: a change is judged
 * on the rules it can break, so no roster is passed to the validator.
 */
export function assessEdits(input: EditsAssessmentInput): EditsAssessment {
  const after = applyAssignmentEdits(input.assignments, input.edits);
  const validate = (assignments: readonly Assignment[]) =>
    validateSchedule({
      period: input.period,
      assignments,
      adjacentAssignments: input.adjacentAssignments,
      staffingRequirements: input.staffingRequirements,
    });
  return {
    after,
    assessment: assessChange({
      before: validate(input.assignments),
      after: validate(after),
      changedCells: input.edits,
    }),
  };
}
