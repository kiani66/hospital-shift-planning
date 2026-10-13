import { describe, expect, it } from "vitest";

import {
  candidateDayStatus,
  evaluateCandidates,
} from "../candidates/evaluate-candidates";
import { planRequestChange } from "../change-requests/plan-change";
import {
  LEAVE_NOT_SWAPPABLE,
  refreshSwap,
  validateNewChangeRequest,
  type ChangeRequestState,
  type NewChangeRequestInput,
} from "../change-requests/request";
import { summarizePreferenceAlignment } from "../preferences/preference-alignment";
import { preferenceFit } from "../preferences/preference-fit";
import {
  assignmentKey,
  planAssignmentEdits,
} from "../schedule/assignment-editing";
import { summarizeScheduleDays } from "../schedule/day-health";
import {
  applyAssignmentEdits,
  planRevisionDiscard,
} from "../schedule/schedule-change";
import { SCHEDULE_STATUSES } from "../schedule/status";
import { addDays, isoDate, type IsoDate } from "../shared/dates";
import { ValidationError } from "../shared/errors";
import type { Assignment } from "../shifts/assignment";
import { countByShift, coverageOf } from "../shifts/coverage";
import {
  ASSIGNMENT_CODES,
  LEAVE_CODE,
  NON_WORKING_CODES,
  PREFERENCE_VALUES,
  SHIFT_CODES,
  isAssignmentCode,
  isFreeToCover,
  isLeave,
  isNightShift,
  isPreferenceValue,
  isShiftCode,
  isWorkingShift,
  type AssignmentCode,
} from "../shifts/shift-type";
import { parseSpreadsheetDayCode } from "../shifts/spreadsheet-codes";
import { summarizeShifts } from "../shifts/working-time";
import { resolveRequirements } from "../staffing-rules/resolve";
import { findNightRestViolations } from "./night-rest";
import type { StaffingRequirement } from "./staffing";
import { validateSchedule } from "./validate-schedule";
import { hasBlockingViolations } from "./violation";

/** D118: Leave (H) is an explicit non-working day status, distinct from OFF. */

const date = isoDate("2026-10-25");
const before = addDays(date, -1);
const period = { start: date, end: date };
const a = (nurseId: string, shift: AssignmentCode, day = date): Assignment => ({
  nurseId,
  date: day,
  shift,
});
const roster = ["a", "b", "c", "d"];
const minimumOne = resolveRequirements(
  {
    normal: {
      M: { min: 1, max: null },
      E: { min: 1, max: null },
      N: { min: 1, max: null },
    },
    holiday: {},
    exceptions: [],
  },
  [date],
  new Set(),
);
const validate = (assignments: Assignment[]) =>
  validateSchedule({
    period,
    assignments,
    rosterNurseIds: roster,
    staffingRequirements: minimumOne as ReadonlyMap<
      IsoDate,
      StaffingRequirement
    >,
  });

describe("H in the day-status vocabulary", () => {
  it("is an explicit decision, never a working shift, a night or a wish", () => {
    expect(ASSIGNMENT_CODES).toEqual(["M", "E", "N", "ME", "OFF", "H"]);
    expect(NON_WORKING_CODES).toEqual(["OFF", "H"]);
    expect(LEAVE_CODE).toBe("H");
    expect(isAssignmentCode("H")).toBe(true);
    expect(isShiftCode("H")).toBe(false);
    expect(isWorkingShift("H")).toBe(false);
    expect(isNightShift("H")).toBe(false);
    // Nurses never wish for leave: OFF stays the rest wish (D35, D118).
    expect(PREFERENCE_VALUES).not.toContain("H");
    expect(isPreferenceValue("H")).toBe(false);
    // Unknown and non-string values stay invalid.
    expect(isAssignmentCode("X")).toBe(false);
    expect(isAssignmentCode(1)).toBe(false);
  });

  it("names leave apart from OFF, undecided and working shifts", () => {
    expect(isLeave("H")).toBe(true);
    for (const code of [...SHIFT_CODES, "OFF", null] as const)
      expect(isLeave(code)).toBe(false);
    // Free to be given a shift by someone else: undecided or OFF only.
    expect(isFreeToCover(null)).toBe(true);
    expect(isFreeToCover("OFF")).toBe(true);
    expect(isFreeToCover("H")).toBe(false);
    for (const code of SHIFT_CODES) expect(isFreeToCover(code)).toBe(false);
  });
});

describe("H adds no working time and no coverage", () => {
  it("counts leave separately with zero minutes, shifts and nights", () => {
    expect(summarizeShifts(["H", "H", "OFF", null])).toEqual({
      shiftCount: 0,
      offCount: 1,
      leaveCount: 2,
      minutes: 0,
      nightCount: 0,
      byCode: { M: 0, E: 0, N: 0, ME: 0 },
    });
    // Existing workload is unchanged by leave days around it.
    expect(summarizeShifts(["M", "H", "N", "H", "ME"])).toEqual(
      expect.objectContaining({
        shiftCount: 3,
        leaveCount: 2,
        minutes: (7 + 12 + 12) * 60,
        nightCount: 1,
      }),
    );
  });

  it("staffs no coverage period", () => {
    const counts = countByShift(["H", "H", "M"]);
    expect(counts).toEqual({ M: 1, E: 0, N: 0, ME: 0 });
    expect(coverageOf(counts)).toEqual({ M: 1, E: 0, N: 0 });
  });

  it("never satisfies a staffing minimum: an all-leave day has three shortages", () => {
    const assignments = roster.map((n) => a(n, "H"));
    const violations = validate(assignments);
    expect(violations.map((v) => v.rule)).toEqual([
      "STAFFING",
      "STAFFING",
      "STAFFING",
    ]);
    expect(violations).toEqual(
      expect.arrayContaining(
        (["M", "E", "N"] as const).map((p) =>
          expect.objectContaining({
            period: p,
            covered: 0,
            status: "BELOW_MINIMUM",
          }),
        ),
      ),
    );
    expect(hasBlockingViolations(violations)).toBe(true);
    expect(
      summarizeScheduleDays({ period, assignments, violations }).days[0],
    ).toMatchObject({
      state: "COVERAGE",
      decisions: 4,
      undecided: 0,
      coverage: { M: 0, E: 0, N: 0 },
      shortages: 3,
      leave: 4,
    });
  });

  it("is a completed decision: a staffed day with leave is ready", () => {
    const assignments = [a("a", "ME"), a("b", "N"), a("c", "H"), a("d", "OFF")];
    const violations = validate(assignments);
    expect(violations).toEqual([]);
    expect(
      summarizeScheduleDays({ period, assignments, violations }).days[0],
    ).toMatchObject({ state: "READY", undecided: 0, leave: 1 });
  });

  it("keeps leave apart from undecided: a missing row is never leave", () => {
    const violations = validate([a("a", "ME"), a("b", "N"), a("c", "H")]);
    expect(violations).toEqual([
      { rule: "UNDECIDED", severity: "error", nurseId: "d", date },
    ]);
  });
});

describe("night rest with leave", () => {
  it("N followed by H is valid, within and across the period boundary", () => {
    expect(findNightRestViolations([a("a", "N", before), a("a", "H")])).toEqual(
      [],
    );
    expect(
      validateSchedule({
        period,
        assignments: [a("a", "H")],
        adjacentAssignments: [a("a", "N", before)],
      }),
    ).toEqual([]);
  });

  it("H is not a night: a shift after leave is valid, and N→work still is not", () => {
    for (const shift of SHIFT_CODES)
      expect(
        findNightRestViolations([a("a", "H", before), a("a", shift)]),
      ).toEqual([]);
    expect(
      findNightRestViolations([a("a", "N", before), a("a", "M")]),
    ).toHaveLength(1);
  });
});

describe("editing leave through the normal editor plan", () => {
  const plan = (
    shift: AssignmentCode | null,
    stored: AssignmentCode | null,
    schedule: Parameters<typeof planAssignmentEdits>[0]["schedule"] = {
      status: "PLANNING",
      period,
      revisionDates: null,
    },
  ) =>
    planAssignmentEdits({
      edits: [{ nurseId: "a", date, shift }],
      current: new Map(
        stored === null ? [] : [[assignmentKey("a", date), stored]],
      ),
      rosterNurseIds: new Set(["a"]),
      schedule,
    });

  it.each([
    ["assigns", null, "H"],
    ["replaces a working shift with", "N", "H"],
    ["replaces OFF with", "OFF", "H"],
    ["replaces leave with a working shift:", "H", "M"],
    ["clears", "H", null],
  ] as const)("%s H as one cell (before %s, after %s)", (_, before, after) => {
    expect(plan(after, before)).toEqual({
      ok: true,
      value: [{ nurseId: "a", date, before, after }],
    });
  });

  it("repeating the stored leave is a no-op", () => {
    expect(plan("H", "H")).toEqual({ ok: true, value: [] });
  });

  it("follows the same status and revision-scope boundaries as any decision", () => {
    for (const status of SCHEDULE_STATUSES) {
      const result = plan("H", null, { status, period, revisionDates: null });
      const editable = ["DRAFT", "PLANNING", "FINALIZED", "RETURNED"].includes(
        status,
      );
      expect(result.ok, status).toBe(editable);
    }
    expect(
      plan("H", null, {
        status: "REVISING",
        period,
        revisionDates: new Set(),
      }).ok,
    ).toBe(false);
    expect(
      plan("H", "M", {
        status: "REVISING",
        period,
        revisionDates: new Set([date]),
      }).ok,
    ).toBe(true);
  });

  it("one decision per nurse and day: leave plus a working shift is a duplicate", () => {
    expect(
      validateSchedule({ period, assignments: [a("a", "M"), a("a", "H")] }),
    ).toEqual([expect.objectContaining({ rule: "DUPLICATE_ASSIGNMENT" })]);
    const result = planAssignmentEdits({
      edits: [
        { nurseId: "a", date, shift: "H" },
        { nurseId: "a", date, shift: "M" },
      ],
      current: new Map(),
      rosterNurseIds: new Set(["a"]),
      schedule: { status: "PLANNING", period, revisionDates: null },
    });
    expect(result.ok).toBe(false);
  });

  it("an approved H is restored by a revision discard", () => {
    const approved = [a("a", "H"), a("b", "M")];
    const working = applyAssignmentEdits(approved, [
      { nurseId: "a", date, shift: "M" },
    ]);
    expect(working).toEqual([a("a", "M"), a("b", "M")]);
    expect(
      planRevisionDiscard({ working, approved }).map((c) => [
        c.nurseId,
        c.before,
        c.after,
      ]),
    ).toEqual([["a", "M", "H"]]);
  });
});

describe("leave is never moved or overwritten by someone else's action", () => {
  it("a nurse on leave is no coverage candidate", () => {
    expect(candidateDayStatus("H")).toBeNull();
    expect(candidateDayStatus("OFF")).toBe("OFF_ASSIGNMENT");
    expect(candidateDayStatus(null)).toBe("UNASSIGNED");
    const result = evaluateCandidates({
      period,
      date,
      shift: "N",
      nurseIds: ["a", "b", "c"],
      assignments: [a("a", "H"), a("b", "OFF")],
      adjacentAssignments: [],
      staffingRequirements: new Map(),
      preferences: new Map(),
    });
    if (!result.ok) throw result.error;
    expect(result.value.available.map((c) => c.nurseId)).toEqual(["c", "b"]);
    expect(result.value.notAllowed).toEqual([]);
  });

  const request = (
    overrides: Partial<NewChangeRequestInput> = {},
  ): NewChangeRequestInput => ({
    type: "SWAP",
    date,
    today: date,
    schedule: { status: "APPROVED", period },
    requesterId: "a",
    requesterShift: "M",
    targetShift: null,
    counterpart: { nurseId: "b", shift: "H" },
    rosterNurseIds: new Set(["a", "b", "c"]),
    reason: {
      code: "ILLNESS",
      scope: "REQUEST",
      requiresNote: false,
      isActive: true,
    },
    note: null,
    ...overrides,
  });
  const refusal = (input: NewChangeRequestInput) => {
    const result = validateNewChangeRequest(input);
    if (result.ok) throw new Error("expected a refusal");
    return result.error;
  };

  it("a swap with a leave day on either side is refused", () => {
    expect(refusal(request())).toEqual(
      new ValidationError(LEAVE_NOT_SWAPPABLE, "counterpartId"),
    );
    expect(
      refusal(
        request({
          requesterShift: "H",
          counterpart: { nurseId: "b", shift: "M" },
        }),
      ),
    ).toEqual(new ValidationError(LEAVE_NOT_SWAPPABLE, "counterpartId"));
    // An undecided partner is still refused when the requester is on leave.
    expect(
      refusal(
        request({
          requesterShift: "H",
          counterpart: { nurseId: "b", shift: null },
        }),
      ),
    ).toBeInstanceOf(ValidationError);
  });

  it("a nurse on leave may ask to work instead, never to be unavailable", () => {
    expect(
      refusal(
        request({
          type: "UNAVAILABLE",
          requesterShift: "H",
          counterpart: null,
        }),
      ),
    ).toEqual(
      new ValidationError("Unavailability requires a working shift", "type"),
    );
    expect(
      validateNewChangeRequest(
        request({
          type: "CHANGE_SHIFT",
          requesterShift: "H",
          targetShift: "M",
          counterpart: null,
        }),
      ).ok,
    ).toBe(true);
  });

  const swap: ChangeRequestState = {
    type: "SWAP",
    status: "PENDING",
    date,
    requesterId: "a",
    requesterShift: "M",
    targetShift: null,
    counterpartId: "b",
    counterpartShift: "E",
    consent: "ACCEPTED",
  };

  it("a swap cannot be refreshed onto a leave day", () => {
    for (const current of [
      { requester: "H", counterpart: "E" },
      { requester: "M", counterpart: "H" },
    ] as const) {
      const result = refreshSwap(swap, current);
      expect(result.ok).toBe(false);
      if (!result.ok)
        expect(result.error).toEqual(
          new ValidationError(LEAVE_NOT_SWAPPABLE, "counterpartId"),
        );
    }
  });

  const unavailable: ChangeRequestState = {
    ...swap,
    type: "UNAVAILABLE",
    counterpartId: null,
    counterpartShift: null,
    consent: null,
  };

  it("an UNAVAILABLE replacement cannot be a nurse on leave; the requester gets OFF, never H", () => {
    const onLeave = planRequestChange({
      request: unavailable,
      current: { requester: "M", counterpart: null, replacement: "H" },
      rosterNurseIds: new Set(["a", "b", "c"]),
      resolution: { replacementNurseId: "c" },
    });
    expect(onLeave).toEqual({
      ok: false,
      error: new ValidationError(
        "The replacement is on leave that day",
        "replacementNurseId",
      ),
    });
    const fromOff = planRequestChange({
      request: unavailable,
      current: { requester: "M", counterpart: null, replacement: "OFF" },
      rosterNurseIds: new Set(["a", "b", "c"]),
      resolution: { replacementNurseId: "c" },
    });
    expect(fromOff).toEqual({
      ok: true,
      value: {
        edits: [
          { nurseId: "a", date, shift: "OFF" },
          { nurseId: "c", date, shift: "M" },
        ],
        stale: null,
      },
    });
  });
});

describe("preferences are unchanged by leave", () => {
  it("an OFF wish against H is an advisory mismatch: never a finding, never blocking", () => {
    expect(
      summarizePreferenceAlignment([
        { preference: "OFF", shift: "H" },
        { preference: "OFF", shift: "OFF" },
      ]),
    ).toMatchObject({ rostered: 2, matches: 1, differs: 1, pending: 0 });
    // Validation never reads preferences: the staffed day stays READY.
    const assignments = [a("a", "ME"), a("b", "N"), a("c", "H"), a("d", "OFF")];
    const violations = validate(assignments);
    expect(violations).toEqual([]);
    expect(hasBlockingViolations(violations)).toBe(false);
    expect(
      summarizeScheduleDays({ period, assignments, violations }).days[0]!.state,
    ).toBe("READY");
  });

  it("an OFF wish is not converted to leave and differs from an H decision", () => {
    // Exact-code comparison (D100) stays: a difference is a neutral note.
    expect(preferenceFit("OFF", "H")).toBe("DIFFERS");
    expect(preferenceFit("OFF", null)).toBe("PENDING");
    expect(preferenceFit(null, "H")).toBe("NONE");
  });
});

describe("Excel day codes", () => {
  it("maps H to leave and every known code to its decision", () => {
    for (const code of ASSIGNMENT_CODES)
      expect(parseSpreadsheetDayCode(code)).toEqual({
        ok: true,
        value: { kind: "DECISION", code },
      });
    expect(parseSpreadsheetDayCode(" h ")).toEqual({
      ok: true,
      value: { kind: "DECISION", code: "H" },
    });
  });

  it("reads an empty cell as undecided, never OFF or leave", () => {
    for (const raw of ["", "   "])
      expect(parseSpreadsheetDayCode(raw)).toEqual({
        ok: true,
        value: { kind: "EMPTY" },
      });
  });

  it("reports unknown codes instead of guessing", () => {
    for (const raw of ["X", " L ", "مرخصی", "toString", "__proto__"])
      expect(parseSpreadsheetDayCode(raw)).toEqual({
        ok: false,
        error: { unknownCode: raw.trim() },
      });
  });
});
