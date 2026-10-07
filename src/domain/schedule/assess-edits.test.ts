import { describe, expect, it } from "vitest";

import { assessChange } from "../rules/assess-change";
import type { StaffingRequirement } from "../rules/staffing";
import { validateSchedule } from "../rules/validate-schedule";
import { isoDate, type IsoDate } from "../shared/dates";
import type { Assignment } from "../shifts/assignment";
import type { AssignmentCode } from "../shifts/shift-type";
import type { AssignmentEdit } from "./assignment-editing";
import { assessEdits, type EditsAssessmentInput } from "./assess-edits";
import { applyAssignmentEdits } from "./schedule-change";

const d = isoDate;
const period = { start: d("2026-10-23"), end: d("2026-11-21") };
const a = (
  nurseId: string,
  date: string,
  shift: AssignmentCode,
): Assignment => ({
  nurseId,
  date: d(date),
  shift,
});
const e = (
  nurseId: string,
  date: string,
  shift: AssignmentCode | null,
): AssignmentEdit => ({ nurseId, date: d(date), shift });
const requirement = (
  date: string,
  value: StaffingRequirement,
): ReadonlyMap<IsoDate, StaffingRequirement> => new Map([[d(date), value]]);

/**
 * The sequence `evaluateScheduleChange` ran inline before `assessEdits` was
 * extracted, kept verbatim as the reference the extraction must reproduce:
 * the changed cells were the planned changes (with their before / after).
 */
function previousInlineAssessment(input: EditsAssessmentInput) {
  const changes = input.edits.map((edit) => ({
    nurseId: edit.nurseId,
    date: edit.date,
    before:
      input.assignments.find(
        (x) => x.nurseId === edit.nurseId && x.date === edit.date,
      )?.shift ?? null,
    after: edit.shift,
  }));
  const after = applyAssignmentEdits(
    input.assignments,
    changes.map((c) => ({ nurseId: c.nurseId, date: c.date, shift: c.after })),
  );
  const validate = (cells: readonly Assignment[]) =>
    validateSchedule({
      period: input.period,
      assignments: cells,
      adjacentAssignments: input.adjacentAssignments,
      staffingRequirements: input.staffingRequirements,
    });
  return {
    after,
    assessment: assessChange({
      before: validate(input.assignments),
      after: validate(after),
      changedCells: changes,
    }),
  };
}

/** Freezes the inputs deeply so any mutation by the helper throws. */
function frozen(input: EditsAssessmentInput): EditsAssessmentInput {
  const freezeAll = <T extends object>(items: readonly T[] | undefined) =>
    items && Object.freeze(items.map((item) => Object.freeze({ ...item })));
  return Object.freeze({
    ...input,
    assignments: freezeAll(input.assignments)!,
    edits: freezeAll(input.edits)!,
    adjacentAssignments: freezeAll(input.adjacentAssignments),
  });
}

const SCENARIOS: Record<string, EditsAssessmentInput> = {
  "night rest introduced on the next day": {
    period,
    assignments: [a("sara", "2026-10-25", "N")],
    edits: [e("sara", "2026-10-26", "M")],
  },
  "Night placed before an existing shift": {
    period,
    assignments: [a("sara", "2026-10-25", "E"), a("sara", "2026-10-26", "M")],
    edits: [e("sara", "2026-10-25", "N")],
  },
  "a pre-existing finding kept, not worsened": {
    period,
    assignments: [a("sara", "2026-10-25", "N"), a("sara", "2026-10-26", "M")],
    edits: [e("sara", "2026-10-26", "E")],
  },
  "OFF replaced by a working shift after a Night": {
    period,
    assignments: [a("sara", "2026-10-25", "N"), a("sara", "2026-10-26", "OFF")],
    edits: [e("sara", "2026-10-26", "N")],
  },
  "a cell cleared to undecided": {
    period,
    assignments: [a("sara", "2026-10-25", "N"), a("sara", "2026-10-26", "M")],
    edits: [e("sara", "2026-10-26", null)],
  },
  "boundary Night from the previous schedule": {
    period,
    assignments: [],
    edits: [e("sara", "2026-10-23", "M")],
    adjacentAssignments: [a("sara", "2026-10-22", "N")],
  },
  "boundary shift in the next schedule after a last-day Night": {
    period,
    assignments: [],
    edits: [e("sara", "2026-11-21", "N")],
    adjacentAssignments: [a("sara", "2026-11-22", "E")],
  },
  "shortage reduced but not resolved": {
    period,
    assignments: [a("sara", "2026-10-25", "N")],
    edits: [e("ali", "2026-10-25", "N")],
    staffingRequirements: requirement("2026-10-25", { N: { min: 3 } }),
  },
  "shortage introduced": {
    period,
    assignments: [a("sara", "2026-10-25", "N"), a("ali", "2026-10-25", "N")],
    edits: [e("ali", "2026-10-25", "OFF")],
    staffingRequirements: requirement("2026-10-25", { N: { min: 2 } }),
  },
  "ME pushing Evening over its maximum": {
    period,
    assignments: [a("sara", "2026-10-25", "E")],
    edits: [e("ali", "2026-10-25", "ME")],
    staffingRequirements: requirement("2026-10-25", {
      M: { min: 2 },
      E: { min: 1, max: 1 },
    }),
  },
  "night rest and staffing in one request": {
    period,
    assignments: [a("sara", "2026-10-25", "M"), a("ali", "2026-10-25", "M")],
    edits: [e("ali", "2026-10-25", null), e("sara", "2026-10-24", "N")],
    staffingRequirements: requirement("2026-10-25", { M: { min: 2 } }),
  },
};

describe("assessEdits", () => {
  it.each(Object.entries(SCENARIOS))(
    "gives exactly the assessment of the previous inline sequence: %s",
    (_, input) => {
      expect(assessEdits(frozen(input))).toEqual(
        previousInlineAssessment(input),
      );
    },
  );

  it("applies the edits to a new list and never mutates its inputs", () => {
    const input = SCENARIOS["OFF replaced by a working shift after a Night"]!;
    const copy = structuredClone(input);
    const { after } = assessEdits(frozen(input));
    expect(input).toEqual(copy);
    expect(after).not.toBe(input.assignments);
    // OFF is replaced in its single cell: never OFF plus a shift (D15, D100).
    expect(after).toEqual([
      a("sara", "2026-10-25", "N"),
      a("sara", "2026-10-26", "N"),
    ]);
  });

  it("blocks an introduced night-rest violation with the structured finding", () => {
    const { assessment } = assessEdits(
      SCENARIOS["night rest introduced on the next day"]!,
    );
    expect(assessment).toEqual({
      introduced: [
        {
          rule: "NIGHT_REST",
          severity: "error",
          nurseId: "sara",
          nightDate: "2026-10-25",
          date: "2026-10-26",
          shift: "M",
        },
      ],
      blocking: assessment.introduced,
      warnings: [],
      persisting: [],
      blocked: true,
    });
  });

  it("does not block a change that only keeps an existing finding", () => {
    const { assessment } = assessEdits(
      SCENARIOS["a pre-existing finding kept, not worsened"]!,
    );
    expect(assessment.blocked).toBe(false);
    expect(assessment.persisting.map((v) => v.rule)).toEqual(["NIGHT_REST"]);
  });

  describe("neighbouring schedules' boundary days (D7, D20)", () => {
    it("blocks a first-day shift after the previous schedule's Night", () => {
      const { assessment } = assessEdits(
        SCENARIOS["boundary Night from the previous schedule"]!,
      );
      expect(assessment.blocking).toEqual([
        {
          rule: "NIGHT_REST",
          severity: "error",
          nurseId: "sara",
          nightDate: "2026-10-22",
          date: "2026-10-23",
          shift: "M",
        },
      ]);
    });

    it("blocks a last-day Night before the next schedule's shift", () => {
      const { assessment } = assessEdits(
        SCENARIOS[
          "boundary shift in the next schedule after a last-day Night"
        ]!,
      );
      expect(assessment.blocking).toMatchObject([
        { rule: "NIGHT_REST", nightDate: "2026-11-21", date: "2026-11-22" },
      ]);
    });

    it("misses the boundary violation without the context, as validation does", () => {
      const { adjacentAssignments: _, ...withoutContext } =
        SCENARIOS["boundary Night from the previous schedule"]!;
      expect(assessEdits(withoutContext).assessment.blocked).toBe(false);
    });

    it("uses only the boundary days of the context (the window is unchanged)", () => {
      const input: EditsAssessmentInput = {
        period,
        assignments: [],
        edits: [e("sara", "2026-10-26", "M")],
        // Context dated inside the period is not a boundary day: ignored.
        adjacentAssignments: [a("sara", "2026-10-25", "N")],
      };
      expect(assessEdits(input)).toEqual(previousInlineAssessment(input));
      expect(assessEdits(input).assessment).toMatchObject({
        blocked: false,
        introduced: [],
      });
    });
  });

  describe("staffing under the given (pinned) requirements (D102, D106)", () => {
    it("keeps a reduced shortage as persisting, not blocking", () => {
      const { assessment } = assessEdits(
        SCENARIOS["shortage reduced but not resolved"]!,
      );
      expect(assessment.blocked).toBe(false);
      expect(assessment.persisting).toEqual([
        {
          rule: "STAFFING",
          severity: "error",
          date: "2026-10-25",
          period: "N",
          covered: 2,
          status: "BELOW_MINIMUM",
          bounds: { min: 3 },
        },
      ]);
    });

    it("blocks a shortage introduced by replacing a shift with OFF", () => {
      const { assessment } = assessEdits(SCENARIOS["shortage introduced"]!);
      expect(assessment.blocking).toMatchObject([
        { rule: "STAFFING", period: "N", covered: 1, status: "BELOW_MINIMUM" },
      ]);
    });

    it("counts ME toward Evening and blocks the overstaffing it causes (D42)", () => {
      const { assessment } = assessEdits(
        SCENARIOS["ME pushing Evening over its maximum"]!,
      );
      expect(assessment.blocking).toEqual([
        {
          rule: "STAFFING",
          severity: "error",
          date: "2026-10-25",
          period: "E",
          covered: 2,
          status: "ABOVE_MAXIMUM",
          bounds: { min: 1, max: 1 },
        },
      ]);
      // The Morning shortage it reduces stays a (non-blocking) finding.
      expect(assessment.persisting).toMatchObject([
        { rule: "STAFFING", period: "M", covered: 1, status: "BELOW_MINIMUM" },
      ]);
    });
  });

  it("never reports completeness: undecided days are not a change's finding", () => {
    const { assessment } = assessEdits({
      period,
      assignments: [],
      edits: [e("sara", "2026-10-25", "M")],
    });
    expect(assessment).toEqual({
      introduced: [],
      blocking: [],
      warnings: [],
      persisting: [],
      blocked: false,
    });
  });
});
