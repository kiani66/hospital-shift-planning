import { describe, expect, it } from "vitest";

import { preferenceFit } from "../preferences/preference-fit";
import { summarizePreferenceAlignment } from "../preferences/preference-alignment";
import { summarizeScheduleDays } from "../schedule/day-health";
import {
  applyAssignmentEdits,
  planRevisionDiscard,
} from "../schedule/schedule-change";
import { planAssignmentEdits } from "../schedule/assignment-editing";
import { isoDate } from "../shared/dates";
import type { Assignment } from "../shifts/assignment";
import { countByShift, coverageOf } from "../shifts/coverage";
import {
  ASSIGNMENT_CODES,
  SHIFT_CODES,
  isAssignmentCode,
  isWorkingShift,
} from "../shifts/shift-type";
import { summarizeShifts } from "../shifts/working-time";
import { findNightRestViolations } from "./night-rest";
import { resolveRequirements } from "../staffing-rules/resolve";
import type { StaffingRequirement } from "./staffing";
import { validateSchedule } from "./validate-schedule";
import { toDiagnostic } from "./diagnostic";
import { hasBlockingViolations } from "./violation";

const date = isoDate("2026-10-25");
const period = { start: date, end: date };
const a = (
  nurseId: string,
  shift: Assignment["shift"],
  day = date,
): Assignment => ({ nurseId, date: day, shift });
const rosterNurseIds = ["a", "b", "c", "d"];
/** The legacy baseline rule set (M/E/N min 1, no max), as migration 0011 stores it. */
const legacyBaseline = {
  normal: {
    M: { min: 1, max: null },
    E: { min: 1, max: null },
    N: { min: 1, max: null },
  },
  holiday: {},
  exceptions: [],
};
const validate = (
  assignments: Assignment[],
  configured = new Map<typeof date, StaffingRequirement>(),
) =>
  validateSchedule({
    period,
    assignments,
    rosterNurseIds,
    staffingRequirements: new Map([
      [
        date,
        {
          ...resolveRequirements(legacyBaseline, [date], new Set()).get(date),
          ...configured.get(date),
        },
      ],
    ]),
  });

describe("explicit scheduling decisions", () => {
  it.each(ASSIGNMENT_CODES)(
    "preference %s uses the complete alignment matrix",
    (preference) => {
      expect(preferenceFit(preference, null)).toBe("PENDING");
      for (const assigned of ASSIGNMENT_CODES)
        expect(preferenceFit(preference, assigned)).toBe(
          assigned === preference ? "MATCHES" : "DIFFERS",
        );
    },
  );
  it("keeps rest, pending and no preference in independent summary dimensions", () => {
    expect(
      summarizePreferenceAlignment([
        { preference: "OFF", shift: "OFF" },
        { preference: "OFF", shift: null },
        { preference: "M", shift: "OFF" },
        { preference: null, shift: "OFF" },
      ]),
    ).toEqual({
      rostered: 4,
      withPreference: 3,
      matches: 1,
      differs: 1,
      pending: 1,
      noPreference: 1,
      unassigned: 1,
    });
  });
  it.each(["M", "E", "N", "ME", "OFF", null, undefined, "garbage", 1])(
    "checks %s without unchecked casts",
    (value) => {
      expect(isWorkingShift(value)).toBe(
        (SHIFT_CODES as readonly unknown[]).includes(value),
      );
      expect(isAssignmentCode(value)).toBe(
        (ASSIGNMENT_CODES as readonly unknown[]).includes(value),
      );
    },
  );
  it("OFF and undecided contribute no coverage, working shifts keep ME semantics", () => {
    expect(countByShift(["OFF", null])).toEqual({ M: 0, E: 0, N: 0, ME: 0 });
    expect(
      coverageOf(countByShift(["M", "E", "N", "ME", "OFF", null])),
    ).toEqual({ M: 2, E: 2, N: 1 });
  });
  it("rest days have their own count and add no working time", () => {
    expect(summarizeShifts(["OFF", "OFF", null])).toEqual({
      shiftCount: 0,
      offCount: 2,
      minutes: 0,
      nightCount: 0,
      byCode: { M: 0, E: 0, N: 0, ME: 0 },
    });
    expect(summarizeShifts(["M", "OFF", "N", null])).toMatchObject({
      shiftCount: 2,
      offCount: 1,
      minutes: 19 * 60,
      nightCount: 1,
    });
  });
  it("missing rows block finalization and are never converted to rest", () => {
    const violations = validate([a("a", "ME"), a("b", "N"), a("c", "OFF")]);
    expect(violations).toEqual([
      { rule: "UNDECIDED", severity: "error", nurseId: "d", date },
    ]);
    expect(hasBlockingViolations(violations)).toBe(true);
    expect(toDiagnostic(violations[0]!, period)).toMatchObject({
      blocking: true,
      scope: "ASSIGNMENT",
      shift: null,
      nurseIds: ["d"],
    });
  });
  it("an all-OFF day is complete but fails every required working period", () => {
    const assignments = rosterNurseIds.map((n) => a(n, "OFF"));
    const violations = validate(assignments);
    expect(violations.map((v) => v.rule)).toEqual([
      "STAFFING",
      "STAFFING",
      "STAFFING",
    ]);
    expect(violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ period: "N", severity: "error", covered: 0 }),
      ]),
    );
    expect(
      summarizeScheduleDays({ period, assignments, violations }).days[0],
    ).toMatchObject({
      // All OFF: every decision made, so not NOT_STARTED, but three shortages.
      state: "COVERAGE",
      decisions: 4,
      undecided: 0,
      coverage: { M: 0, E: 0, N: 0 },
      shortages: 3,
    });
  });
  it("complete and sufficiently staffed days pass, including ME for M/E", () => {
    expect(
      validate([a("a", "ME"), a("b", "N"), a("c", "OFF"), a("d", "OFF")]),
    ).toEqual([]);
  });
  it("configured minima override the baseline while missing minima still use one", () => {
    const assignments = [
      a("a", "ME"),
      a("b", "N"),
      a("c", "OFF"),
      a("d", "OFF"),
    ];
    expect(
      validate(
        assignments,
        new Map([[date, { M: { min: 2 }, E: { max: 3 } }]]),
      ),
    ).toEqual([
      {
        rule: "STAFFING",
        severity: "error",
        date,
        period: "M",
        covered: 1,
        status: "BELOW_MINIMUM",
        bounds: { min: 2 },
      },
    ]);
    expect(
      resolveRequirements(
        {
          ...legacyBaseline,
          normal: { ...legacyBaseline.normal, N: { min: 0, max: null } },
        },
        [date],
        new Set(),
      ).get(date)?.N?.min,
    ).toBe(0);
  });
  it("N to explicit OFF is valid both within and across period boundaries", () => {
    const before = isoDate("2026-10-24");
    expect(
      findNightRestViolations([a("a", "N", before), a("a", "OFF")]),
    ).toEqual([]);
    expect(
      validateSchedule({
        period,
        assignments: [a("a", "OFF")],
        adjacentAssignments: [a("a", "N", before)],
      }),
    ).toEqual([]);
    // Draft boundary behavior is preserved: missing next-day decisions alone do not break night rest.
    expect(findNightRestViolations([a("a", "N")])).toEqual([]);
    for (const shift of SHIFT_CODES)
      expect(
        findNightRestViolations([a("a", "N", before), a("a", shift)]),
      ).toHaveLength(1);
  });
  it("OFF respects the one-decision invariant and revision scope", () => {
    expect(
      validateSchedule({ period, assignments: [a("a", "M"), a("a", "OFF")] }),
    ).toEqual([expect.objectContaining({ rule: "DUPLICATE_ASSIGNMENT" })]);
    const plan = planAssignmentEdits({
      edits: [{ nurseId: "a", date, shift: "OFF" }],
      current: new Map(),
      rosterNurseIds: new Set(["a"]),
      schedule: { status: "REVISING", period, revisionDates: new Set() },
    });
    expect(plan.ok).toBe(false);
  });
  it("approved OFF is restored on discard; clearing it remains undecided", () => {
    const approved = [a("a", "OFF"), a("b", "M")];
    const working = applyAssignmentEdits(approved, [
      { nurseId: "a", date, shift: "N" },
      { nurseId: "b", date, shift: null },
    ]);
    expect(planRevisionDiscard({ approved, working })).toEqual([
      { nurseId: "a", date, before: "N", after: "OFF" },
      { nurseId: "b", date, before: null, after: "M" },
    ]);
    expect(
      applyAssignmentEdits(approved, [{ nurseId: "a", date, shift: null }]),
    ).toEqual([a("b", "M")]);
  });
});
