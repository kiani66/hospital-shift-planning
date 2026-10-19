import { describe, expect, it, vi } from "vitest";
import type { StaffingRequirement } from "../rules/staffing";
import { addDays, isoDate } from "../shared/dates";
import { periodDays } from "../shared/period";
import type { Assignment } from "../shifts/assignment";
import * as editsAssessment from "./assess-edits";
import { assessChange } from "../rules/assess-change";
import type { Violation } from "../rules/violation";
import { assignmentKey } from "./assignment-editing";
import { mapCopyDates, planScheduleCopy } from "./copy";

const sourcePeriod = {
  start: isoDate("2026-09-23"),
  end: isoDate("2026-10-22"),
};
const targetPeriod = {
  start: isoDate("2026-10-23"),
  end: isoDate("2026-11-21"),
};
const a = (
  date: string,
  shift: Assignment["shift"] = "M",
  nurseId = "n1",
): Assignment => ({ date: isoDate(date), shift, nurseId });
type Input = Parameters<typeof planScheduleCopy>[0];
type Mutable<T> = { -readonly [K in keyof T]: T[K] };
type Fixture = Omit<Mutable<Input>, "source" | "target"> & {
  source: Mutable<Input["source"]>;
  target: Mutable<Input["target"]>;
};
const base = (): Fixture => ({
  scope: { mode: "MONTH" },
  selection: {},
  source: {
    departmentId: "icu",
    period: sourcePeriod,
    assignments: [a("2026-09-23")],
  },
  target: {
    departmentId: "icu",
    period: targetPeriod,
    status: "PLANNING",
    revisionDates: null,
    assignments: [],
  },
  rosterNurseIds: new Set(["n1", "n2", "new"]),
  eligibleCells: new Set(
    periodDays(targetPeriod).flatMap((d) =>
      ["n1", "n2", "new"].map((n) => assignmentKey(n, d)),
    ),
  ),
  preferences: new Map(),
  adjacentAssignments: [],
  staffingNurseIds: ["n1", "n2"],
  staffingRequirements: new Map(),
});

describe("copy date mapping", () => {
  it("maps the day number of whole monthly periods", () => {
    const map = mapCopyDates({ mode: "MONTH" }, sourcePeriod, targetPeriod);
    expect(map.size).toBe(30);
    expect(map.get(sourcePeriod.start)).toBe(targetPeriod.start);
    expect(map.get(sourcePeriod.end)).toBe(targetPeriod.end);
  });
  it("handles Jalali 31→30, 30→29 and 29→31 without rolling into another month", () => {
    for (const [s, t] of [
      [31, 30],
      [30, 29],
      [29, 31],
    ] as const) {
      const map = mapCopyDates(
        { mode: "MONTH" },
        { start: sourcePeriod.start, end: addDays(sourcePeriod.start, s - 1) },
        { start: targetPeriod.start, end: addDays(targetPeriod.start, t - 1) },
      );
      expect([...map.values()].filter(Boolean)).toHaveLength(Math.min(s, t));
      expect([...map.values()].filter((d) => d === null)).toHaveLength(
        Math.max(s - t, 0),
      );
    }
  });
  it("maps a single day and a range positionally", () => {
    expect([
      ...mapCopyDates(
        {
          mode: "DAY",
          sourceDate: isoDate("2026-10-02"),
          targetDate: isoDate("2026-11-01"),
        },
        sourcePeriod,
        targetPeriod,
      ),
    ]).toEqual([["2026-10-02", "2026-11-01"]]);
    expect([
      ...mapCopyDates(
        {
          mode: "RANGE",
          sourceStart: sourcePeriod.start,
          sourceEnd: addDays(sourcePeriod.start, 2),
          targetStart: addDays(targetPeriod.end, -1),
        },
        sourcePeriod,
        targetPeriod,
      ).values(),
    ]).toEqual(["2026-11-20", "2026-11-21", null]);
  });
  it.each([
    {
      mode: "DAY" as const,
      sourceDate: isoDate("2026-09-22"),
      targetDate: targetPeriod.start,
    },
    {
      mode: "RANGE" as const,
      sourceStart: sourcePeriod.start,
      sourceEnd: isoDate("2026-10-23"),
      targetStart: targetPeriod.start,
    },
    {
      mode: "RANGE" as const,
      sourceStart: sourcePeriod.end,
      sourceEnd: sourcePeriod.start,
      targetStart: targetPeriod.start,
    },
    {
      mode: "DAY" as const,
      sourceDate: sourcePeriod.start,
      targetDate: isoDate("2026-11-22"),
    },
  ])("rejects invalid scope %j", (scope) =>
    expect(() => mapCopyDates(scope, sourcePeriod, targetPeriod)).toThrow(),
  );
});

describe("intelligent copy plan", () => {
  it("creates independent target assignments, skips missing roster members and never assigns target-only members", () => {
    const input = base();
    input.source.assignments = [
      a("2026-09-24", "E", "n2"),
      a("2026-09-23", "M", "n2"),
      a("2026-09-23"),
      a("2026-09-23", "M", "absent"),
    ];
    const before = JSON.stringify(input.source);
    const plan = planScheduleCopy(input);
    expect(plan.proposed).toEqual([
      a("2026-10-23"),
      a("2026-10-23", "M", "n2"),
      a("2026-10-24", "E", "n2"),
    ]);
    expect(plan.rows[0]!.reason).toBe("NURSE_NOT_IN_TARGET_ROSTER");
    expect(plan.affectedNurseIds).toEqual(["n1", "n2"]);
    expect(plan.canApply).toBe(true);
    expect(JSON.stringify(input.source)).toBe(before);
  });
  it("filters personnel and composite assignment selections within the source scope", () => {
    const input = base();
    input.scope = {
      mode: "DAY",
      sourceDate: sourcePeriod.start,
      targetDate: targetPeriod.start,
    };
    input.source.assignments = [
      a("2026-09-23"),
      a("2026-09-23", "E", "n2"),
      a("2026-09-24"),
    ];
    input.selection = { nurseIds: ["n1"] };
    expect(planScheduleCopy(input).sourceAssignmentCount).toBe(1);
    input.selection = {
      sourceCells: [{ nurseId: "n2", date: sourcePeriod.start }],
    };
    expect(planScheduleCopy(input).proposed).toEqual([
      a("2026-10-23", "E", "n2"),
    ]);
    input.selection = {
      nurseIds: ["n1"],
      sourceCells: [{ nurseId: "n2", date: sourcePeriod.start }],
    };
    expect(planScheduleCopy(input).proposed).toEqual([]);
  });
  it("explicitly skips source leave, invalid destination days, and ineligible target memberships/accounts", () => {
    const input = base();
    input.target.period = {
      start: targetPeriod.start,
      end: targetPeriod.start,
    };
    input.source.assignments = [
      a("2026-09-23", "H"),
      a("2026-09-24"),
      a("2026-09-23", "E", "n2"),
    ];
    input.eligibleCells = new Set();
    const p = planScheduleCopy(input);
    expect(p.rows.map((r) => r.reason)).toEqual([
      "SOURCE_LEAVE_NOT_COPIED",
      "NOT_ELIGIBLE_ON_TARGET_DATE",
      "TARGET_DATE_DOES_NOT_EXIST",
    ]);
    expect(p.skippedCount).toBe(3);
    expect(p.canApply).toBe(false);
  });
  it("preserves target leave, OFF, different shifts, and exact duplicates", () => {
    const input = base();
    input.source.assignments = [
      a("2026-09-23"),
      a("2026-09-24"),
      a("2026-09-25"),
      a("2026-09-26"),
    ];
    input.target.assignments = [
      a("2026-10-23", "H"),
      a("2026-10-24", "OFF"),
      a("2026-10-25", "E"),
      a("2026-10-26"),
    ];
    const p = planScheduleCopy(input);
    expect(p.rows.map((r) => r.reason)).toEqual([
      "LEAVE_CONFLICT",
      ...Array(3).fill("TARGET_ASSIGNMENT_ALREADY_EXISTS"),
    ]);
    expect(p.conflictCount).toBe(3);
    expect(p.unchangedCount).toBe(1);
    expect(p.proposed).toEqual([]);
  });
  it.each(["APPROVED", "SUBMITTED"] as const)(
    "keeps %s immutable",
    (status) => {
      const input = base();
      input.target.status = status;
      expect(planScheduleCopy(input).rows[0]!.reason).toBe(
        "TARGET_SCHEDULE_NOT_EDITABLE",
      );
    },
  );
  it("respects revision dates using the existing editability rule", () => {
    const input = base();
    input.target.status = "REVISING";
    input.target.revisionDates = new Set();
    expect(planScheduleCopy(input).rows[0]!.reason).toBe(
      "DATE_OUTSIDE_REVISION_SCOPE",
    );
    input.target.revisionDates = new Set([targetPeriod.start]);
    expect(planScheduleCopy(input).canApply).toBe(true);
  });
  it("rejects another department", () => {
    const input = base();
    input.target.departmentId = "er";
    expect(() => planScheduleCopy(input)).toThrow("same department");
  });
  it("assesses target rest and adjacent schedules even for a nurse with no target assignments", () => {
    const input = base();
    input.adjacentAssignments = [a("2026-10-22", "N")];
    const p = planScheduleCopy(input);
    expect(p.assessment.blocking[0]!.rule).toBe("NIGHT_REST");
    expect(p.canApply).toBe(true);
    expect(p.correctableViolations).toHaveLength(1);
    expect(p.blockingViolations).toEqual([]);
  });
  it("assesses the batch together and reports correctable inter-row rest violations", () => {
    const input = base();
    input.source.assignments = [a("2026-09-23", "N"), a("2026-09-24", "M")];
    const p = planScheduleCopy(input);
    expect(p.assessment.blocking[0]!.rule).toBe("NIGHT_REST");
    expect(p.canApply).toBe(true);
    expect(p.proposed).toHaveLength(2);
    expect(p.correctableViolations).toHaveLength(1);
  });
  it("uses target staffing maxima, keeps shortages as context, and reports target coverage", () => {
    const input = base();
    const req: StaffingRequirement = { M: { min: 0, max: 0 } };
    input.staffingRequirements = new Map([[targetPeriod.start, req]]);
    const p = planScheduleCopy(input);
    expect(p.assessment.blocking[0]!).toMatchObject({
      rule: "STAFFING",
      status: "ABOVE_MAXIMUM",
    });
    expect(p.canApply).toBe(true);
    expect(p.correctableViolations[0]!.rule).toBe("STAFFING");
    expect(p.coverage[0]!.periods[0]!).toMatchObject({
      before: 0,
      after: 1,
      status: "ABOVE_MAXIMUM",
    });
    input.staffingRequirements = new Map([
      [targetPeriod.start, { M: { min: 3, max: undefined } }],
    ]);
    expect(planScheduleCopy(input).canApply).toBe(true);
  });
  it("retains advisory OFF/different target preferences without copying any preferences", () => {
    const input = base();
    input.preferences = new Map([
      [assignmentKey("n1", targetPeriod.start), "OFF"],
    ]);
    const p = planScheduleCopy(input);
    expect(p.preferenceNotes).toEqual([
      { ...a("2026-10-23"), reason: "TARGET_PREFERENCE_DIFFERS" },
    ]);
    expect(p.canApply).toBe(true);
    expect(input.preferences.size).toBe(1);
    input.preferences = new Map([
      [assignmentKey("n1", targetPeriod.start), "M"],
    ]);
    expect(planScheduleCopy(input).preferenceNotes).toEqual([]);
  });
  it("same-schedule overlapping ranges read a stable source snapshot and never cascade or overwrite", () => {
    const input = base();
    input.source.period = targetPeriod;
    input.source.assignments = [a("2026-10-23"), a("2026-10-24", "E")];
    input.target.assignments = input.source.assignments;
    input.scope = {
      mode: "RANGE",
      sourceStart: targetPeriod.start,
      sourceEnd: addDays(targetPeriod.start, 1),
      targetStart: addDays(targetPeriod.start, 1),
    };
    const p = planScheduleCopy(input);
    expect(p.proposed).toEqual([a("2026-10-25", "E")]);
    expect(p.conflictCount).toBe(1);
    expect(input.source.assignments).toHaveLength(2);
  });
});

it("preserves non-blocking soft-rule warnings supplied by the shared engine", () => {
  const input = base();
  // Current production validators emit errors. Exercise the existing generic
  // warning contract without adding or downgrading a production rule.
  const warning: Violation = {
    rule: "STAFFING",
    severity: "warning",
    date: targetPeriod.start,
    period: "M",
    covered: 1,
    status: "ABOVE_MAXIMUM",
    bounds: { max: 0 },
  };
  const assessment = assessChange({
    before: [],
    after: [warning],
    changedCells: [{ nurseId: "n1", date: targetPeriod.start }],
  });
  vi.spyOn(editsAssessment, "assessEdits").mockReturnValue({
    after: [],
    assessment,
  });
  const plan = planScheduleCopy(input);
  expect(plan.assessment.warnings).toEqual([warning]);
  expect(plan.assessment.blocking).toEqual([]);
  expect(plan.canApply).toBe(true);
});

it("keeps structural duplicate/out-of-period findings blocking and rejects malformed shifts", () => {
  const input = base();
  input.source.assignments = [a("2026-09-23"), a("2026-09-23", "E")];
  expect(() => planScheduleCopy(input)).toThrow(
    "Invalid source assignment structure",
  );
  input.source.assignments = [a("2026-09-23")];
  input.target.assignments = [
    a("2026-10-23", "OFF", "n2"),
    a("2026-10-23", "M", "n2"),
  ];
  const duplicate = planScheduleCopy(input);
  expect(duplicate.canApply).toBe(false);
  expect(duplicate.blockingViolations[0]!.rule).toBe("DUPLICATE_ASSIGNMENT");
  input.source.assignments = [a("2026-09-23")];
  input.target.assignments = [a("2026-10-22", "OFF")];
  expect(planScheduleCopy(input).blockingViolations[0]!.rule).toBe(
    "OUTSIDE_PERIOD",
  );
  expect(planScheduleCopy(input).canApply).toBe(false);
  input.source.assignments = [a("2026-09-23", "BAD" as Assignment["shift"])];
  expect(() => planScheduleCopy(input)).toThrow(
    "Invalid source assignment code",
  );
});

it("reports remaining staffing shortages without miscounting eligible assignments", () => {
  const input = base();
  input.staffingRequirements = new Map([
    [targetPeriod.start, { M: { min: 3 } }],
  ]);
  const p = planScheduleCopy(input);
  expect(p.correctableViolations).toContainEqual(
    expect.objectContaining({
      rule: "STAFFING",
      status: "BELOW_MINIMUM",
      covered: 1,
    }),
  );
  expect(p.proposed).toHaveLength(1);
  expect(p.canApply).toBe(true);
  expect(p.skippedCount + p.conflictCount).toBe(0);
  expect(input.target.status).toBe("PLANNING");
});
