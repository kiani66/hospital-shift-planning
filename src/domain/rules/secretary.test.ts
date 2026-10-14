import { describe, expect, it } from "vitest";
import type { Actor } from "../authz/actor";
import { decide } from "../authz/policies";
import { evaluateCandidates } from "../candidates/evaluate-candidates";
import { planAssignmentEdits } from "../schedule/assignment-editing";
import { assessEdits } from "../schedule/assess-edits";
import { summarizeScheduleDays } from "../schedule/day-health";
import { isoDate } from "../shared/dates";
import type { Assignment } from "../shifts/assignment";
import { ASSIGNMENT_CODES } from "../shifts/shift-type";
import { summarizeShifts } from "../shifts/working-time";
import { staffingImpact } from "./assess-change";
import { validateSchedule } from "./validate-schedule";

const date = isoDate("2026-09-23");
const period = { start: date, end: date };
const secretary: Actor = {
  userId: "secretary",
  isActive: true,
  isHospitalAdmin: false,
  memberships: [{ departmentId: "nicu", role: "SECRETARY" }],
  supervisedDepartmentIds: [],
};
const assignments: Assignment[] = ["nurse1", "nurse2", "secretary"].map(
  (nurseId) => ({ nurseId, date, shift: "M" }),
);
const staffingNurseIds = ["nurse1", "nurse2"];

describe("secretary scheduling and nursing boundaries", () => {
  it.each(ASSIGNMENT_CODES)(
    "allows manual %s without defaulting unassigned days",
    (shift) => {
      expect(
        planAssignmentEdits({
          edits: [{ nurseId: "secretary", date, shift }],
          current: new Map(),
          rosterNurseIds: new Set(["secretary"]),
          schedule: { status: "PLANNING", period, revisionDates: null },
        }),
      ).toMatchObject({ ok: true, value: [{ before: null, after: shift }] });
      expect(
        summarizeScheduleDays({ period, assignments: [], violations: [] })
          .days[0]!.shifts.M,
      ).toBe(0);
    },
  );
  it("excludes secretary from min AND max, while keeping completeness and rest", () => {
    for (const bounds of [{ min: 3 }, { max: 2 }]) {
      const violations = validateSchedule({
        period,
        assignments,
        staffingNurseIds,
        staffingRequirements: new Map([[date, { M: bounds }]]),
      });
      if (bounds.min)
        expect(violations).toMatchObject([{ rule: "STAFFING", covered: 2 }]);
      else expect(violations).toEqual([]);
    }
    expect(
      validateSchedule({
        period,
        assignments: [],
        rosterNurseIds: ["secretary"],
        staffingNurseIds: [],
      }),
    ).toMatchObject([{ rule: "UNDECIDED", nurseId: "secretary" }]);
    expect(
      validateSchedule({
        period: { start: date, end: isoDate("2026-09-24") },
        assignments: [
          { nurseId: "secretary", date, shift: "N" },
          { nurseId: "secretary", date: isoDate("2026-09-24"), shift: "M" },
        ],
        staffingNurseIds: [],
      }),
    ).toMatchObject([{ rule: "NIGHT_REST" }]);
  });
  it("separates all assignment counts from nursing coverage and change impacts", () => {
    const summary = summarizeScheduleDays({
      period,
      assignments,
      violations: [],
      staffingNurseIds,
    });
    expect(summary.days[0]).toMatchObject({
      shifts: { M: 3 },
      coverage: { M: 2 },
    });
    expect(
      staffingImpact({
        before: assignments,
        after: assignments.filter((a) => a.nurseId !== "secretary"),
        dates: [date],
        staffingNurseIds,
      })[0]!.periods[0],
    ).toMatchObject({ before: 2, after: 2 });
    expect(
      assessEdits({
        period,
        assignments,
        edits: [{ nurseId: "secretary", date, shift: "ME" }],
        staffingNurseIds,
        staffingRequirements: new Map([
          [date, { M: { max: 2 }, E: { max: 0 } }],
        ]),
      }).assessment.blocked,
    ).toBe(false);
    expect(
      summarizeScheduleDays({
        period,
        assignments,
        violations: [],
        staffingNurseIds: [],
      }).days[0]!.coverage.M,
    ).toBe(0);
  });
  it("never recommends a secretary even when their identifier is in the universe", () => {
    const result = evaluateCandidates({
      period,
      date,
      shift: "M",
      nurseIds: ["nurse1", "secretary"],
      staffingNurseIds: ["nurse1"],
      assignments: [],
      adjacentAssignments: [],
      staffingRequirements: new Map(),
      preferences: new Map(),
    });
    expect(result).toMatchObject({
      ok: true,
      value: { available: [{ nurseId: "nurse1" }] },
    });
  });
  it("retains personal working hours, rest and leave without payroll assumptions", () => {
    const totals = summarizeShifts(["M", "E", "N", "ME", "OFF", "H", null]);
    expect(totals).toMatchObject({
      shiftCount: 4,
      offCount: 1,
      leaveCount: 1,
      nightCount: 1,
    });
    expect(totals.minutes).toBeGreaterThan(0);
  });
  it("grants own access and refuses all departmental/admin privileges", () => {
    expect(
      decide(secretary, "schedule.viewOwn", {
        departmentId: "nicu",
        onRoster: true,
      }).allowed,
    ).toBe(true);
    expect(
      decide(secretary, "preference.editOwn", { departmentId: "nicu" }).allowed,
    ).toBe(true);
    expect(
      decide(secretary, "changeRequest.submit", {
        departmentId: "nicu",
        status: "APPROVED",
      }).allowed,
    ).toBe(true);
    for (const action of [
      "assignment.edit",
      "schedule.create",
      "schedule.resetPlanning",
      "department.manage",
    ] as const)
      expect(decide(secretary, action, { departmentId: "nicu" }).allowed).toBe(
        false,
      );
    expect(
      decide(secretary, "schedule.viewDepartment", {
        departmentId: "nicu",
        status: "APPROVED",
      }).allowed,
    ).toBe(false);
    expect(decide(secretary, "personnel.import", {}).allowed).toBe(false);
    expect(
      decide(secretary, "schedule.approve", {
        departmentId: "nicu",
        submittedBy: "head",
      }).allowed,
    ).toBe(false);
  });
});
