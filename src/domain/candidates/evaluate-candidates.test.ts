import { describe, expect, it } from "vitest";

import type { StaffingRequirement } from "../rules/staffing";
import { assessEdits } from "../schedule/assess-edits";
import { isoDate, type IsoDate } from "../shared/dates";
import { ValidationError } from "../shared/errors";
import type { Assignment } from "../shifts/assignment";
import type {
  AssignmentCode,
  BaseShift,
  PreferenceValue,
} from "../shifts/shift-type";
import {
  candidateDayStatus,
  candidatePreference,
  compareAvailableCandidates,
  compareCandidateIds,
  evaluateCandidates,
  isCandidateShift,
  type AvailableCandidate,
  type CandidateEvaluation,
  type CandidateEvaluationInput,
} from "./evaluate-candidates";

const d = isoDate;
const period = { start: d("2026-10-23"), end: d("2026-11-21") };
const DAY = d("2026-10-25");
const a = (
  nurseId: string,
  date: string,
  shift: AssignmentCode,
): Assignment => ({
  nurseId,
  date: d(date),
  shift,
});
// Canonical lower-case UUIDs, as PostgreSQL returns them; n(1) < n(2) < …
const n = (i: number) =>
  `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
const [N1, N2, N3, N4, N5] = [1, 2, 3, 4, 5].map(n) as [
  string,
  string,
  string,
  string,
  string,
];

function input(
  overrides: Partial<CandidateEvaluationInput> = {},
): CandidateEvaluationInput {
  return {
    period,
    date: DAY,
    shift: "N",
    nurseIds: [],
    assignments: [],
    adjacentAssignments: [],
    staffingRequirements: new Map(),
    preferences: new Map(),
    ...overrides,
  };
}

function evaluate(overrides: Partial<CandidateEvaluationInput>) {
  const result = evaluateCandidates(input(overrides));
  if (!result.ok) throw result.error;
  return result.value;
}

const ids = (list: readonly { nurseId: string }[]) =>
  list.map((c) => c.nurseId);
const prefs = (entries: [string, PreferenceValue][]) => new Map(entries);

describe("target shift", () => {
  it.each(["M", "E", "N"] as const)("accepts %s", (shift) => {
    expect(isCandidateShift(shift)).toBe(true);
    const result = evaluateCandidates(input({ shift, nurseIds: [N1] }));
    expect(result.ok && result.value).toMatchObject({
      shift,
      date: DAY,
      available: [{ nurseId: N1 }],
    });
  });

  it.each(["ME", "OFF", "X", null])(
    "refuses %s as a candidate target",
    (shift) => {
      expect(isCandidateShift(shift)).toBe(false);
      const result = evaluateCandidates(
        input({ shift: shift as BaseShift, nurseIds: [N1] }),
      );
      expect(result).toEqual({ ok: false, error: expect.any(ValidationError) });
      expect(!result.ok && result.error.field).toBe("shift");
    },
  );

  it("refuses a date outside the schedule period", () => {
    const result = evaluateCandidates(
      input({ date: d("2026-11-22"), nurseIds: [N1] }),
    );
    expect(!result.ok && result.error).toMatchObject({
      code: "VALIDATION",
      field: "date",
    });
  });
});

describe("target-day status", () => {
  it("evaluates an unassigned nurse and a nurse with an explicit OFF", () => {
    expect(candidateDayStatus(null)).toBe("UNASSIGNED");
    expect(candidateDayStatus("OFF")).toBe("OFF_ASSIGNMENT");
    const result = evaluate({
      nurseIds: [N1, N2],
      assignments: [a(N2, "2026-10-25", "OFF")],
    });
    expect(result.available).toMatchObject([
      { nurseId: N1, dayStatus: "UNASSIGNED" },
      { nurseId: N2, dayStatus: "OFF_ASSIGNMENT" },
    ]);
  });

  it.each(["M", "E", "N", "ME"] as const)(
    "leaves out a nurse who already works %s that day (no reshuffling)",
    (shift) => {
      expect(candidateDayStatus(shift)).toBeNull();
      const result = evaluate({
        nurseIds: [N1, N2],
        // The Night before would block N1, yet N1 is not listed as Not Allowed.
        assignments: [a(N1, "2026-10-24", "N"), a(N1, "2026-10-25", shift)],
      });
      expect(ids(result.available)).toEqual([N2]);
      expect(result.notAllowed).toEqual([]);
    },
  );

  it("reads only the target day: shifts on other days do not exclude", () => {
    const result = evaluate({
      shift: "M",
      nurseIds: [N1],
      assignments: [a(N1, "2026-10-24", "M"), a(N1, "2026-10-26", "M")],
    });
    expect(ids(result.available)).toEqual([N1]);
  });

  it("counts a repeated universe id once", () => {
    const result = evaluate({ nurseIds: [N1, N1, N2] });
    expect(ids(result.available)).toEqual([N1, N2]);
  });
});

describe("preference classification (exact code)", () => {
  it.each<[BaseShift, PreferenceValue | null, string]>([
    ["M", "M", "SAME_SHIFT"],
    ["N", "N", "SAME_SHIFT"],
    ["M", null, "NONE"],
    ["M", "E", "DIFFERENT_SHIFT"],
    ["E", "N", "DIFFERENT_SHIFT"],
    ["M", "ME", "DIFFERENT_SHIFT"],
    ["E", "ME", "DIFFERENT_SHIFT"],
    ["M", "OFF", "OFF_PREFERENCE"],
  ])("target %s, preference %s → %s", (shift, preference, expected) => {
    expect(candidatePreference(shift, preference)).toBe(expected);
  });

  it("classifies from the target day's stored preferences, never blocking", () => {
    const result = evaluate({
      shift: "M",
      nurseIds: [N1, N2, N3, N4, N5],
      preferences: prefs([
        [N1, "OFF"],
        [N2, "ME"],
        [N3, "M"],
        [N5, "E"],
      ]),
    });
    expect(result.notAllowed).toEqual([]);
    expect(result.available.map((c) => [c.nurseId, c.preference])).toEqual([
      [N3, "SAME_SHIFT"],
      [N4, "NONE"],
      [N2, "DIFFERENT_SHIFT"],
      [N5, "DIFFERENT_SHIFT"],
      [N1, "OFF_PREFERENCE"],
    ]);
  });
});

describe("Available ordering: day status → preference → users.id", () => {
  const available = (
    nurseId: string,
    dayStatus: AvailableCandidate["dayStatus"],
    preference: AvailableCandidate["preference"],
  ): AvailableCandidate => ({
    group: "AVAILABLE",
    nurseId,
    dayStatus,
    preference,
    requiresOffReplacement: dayStatus === "OFF_ASSIGNMENT",
  });

  it("puts UNASSIGNED before OFF_ASSIGNMENT", () => {
    const result = evaluate({
      nurseIds: [N1, N2],
      assignments: [a(N1, "2026-10-25", "OFF")],
    });
    expect(ids(result.available)).toEqual([N2, N1]);
  });

  it("orders preferences SAME_SHIFT, NONE, DIFFERENT_SHIFT, OFF_PREFERENCE", () => {
    const result = evaluate({
      nurseIds: [N1, N2, N3, N4],
      preferences: prefs([
        [N1, "OFF"],
        [N2, "M"],
        [N4, "N"],
      ]),
    });
    expect(result.available.map((c) => c.preference)).toEqual([
      "SAME_SHIFT",
      "NONE",
      "DIFFERENT_SHIFT",
      "OFF_PREFERENCE",
    ]);
    expect(ids(result.available)).toEqual([N4, N3, N2, N1]);
  });

  it("lets day status outrank preference (UNASSIGNED + OFF wish before OFF + same wish)", () => {
    const result = evaluate({
      nurseIds: [N1, N2],
      assignments: [a(N1, "2026-10-25", "OFF")],
      preferences: prefs([
        [N1, "N"], // B: OFF_ASSIGNMENT + SAME_SHIFT
        [N2, "OFF"], // A: UNASSIGNED + OFF_PREFERENCE
      ]),
    });
    expect(result.available).toMatchObject([
      { nurseId: N2, dayStatus: "UNASSIGNED", preference: "OFF_PREFERENCE" },
      { nurseId: N1, dayStatus: "OFF_ASSIGNMENT", preference: "SAME_SHIFT" },
    ]);
    expect(
      compareAvailableCandidates(
        available(N2, "UNASSIGNED", "OFF_PREFERENCE"),
        available(N1, "OFF_ASSIGNMENT", "SAME_SHIFT"),
      ),
    ).toBeLessThan(0);
  });

  it("breaks ties by users.id ascending, never by input order", () => {
    const universe = [N3, N1, N5, N2, N4];
    const result = evaluate({ nurseIds: universe });
    expect(ids(result.available)).toEqual([N1, N2, N3, N4, N5]);
    expect(
      ids(evaluate({ nurseIds: [...universe].reverse() }).available),
    ).toEqual([N1, N2, N3, N4, N5]);
  });

  it("compares ids by code unit, not by locale", () => {
    expect(compareCandidateIds("a", "b")).toBe(-1);
    expect(compareCandidateIds("b", "a")).toBe(1);
    expect(compareCandidateIds("a", "a")).toBe(0);
    // Upper case sorts before lower case in code-unit order (a locale would not).
    expect(compareCandidateIds("B", "a")).toBe(-1);
    expect(
      compareAvailableCandidates(
        available(N1, "UNASSIGNED", "NONE"),
        available(N1, "UNASSIGNED", "NONE"),
      ),
    ).toBe(0);
  });
});

describe("hard rules through the shared assessment (assessEdits)", () => {
  it("makes a valid hypothetical assignment Available", () => {
    const result = evaluate({ nurseIds: [N1] });
    expect(result).toEqual({
      date: DAY,
      shift: "N",
      available: [
        {
          group: "AVAILABLE",
          nurseId: N1,
          dayStatus: "UNASSIGNED",
          preference: "NONE",
          requiresOffReplacement: false,
        },
      ],
      notAllowed: [],
    });
  });

  it("makes a night-rest violation Not Allowed with the structured finding", () => {
    const result = evaluate({
      shift: "M",
      nurseIds: [N1],
      assignments: [a(N1, "2026-10-24", "N")],
    });
    expect(result.available).toEqual([]);
    expect(result.notAllowed).toEqual([
      {
        group: "NOT_ALLOWED",
        nurseId: N1,
        dayStatus: "UNASSIGNED",
        preference: "NONE",
        blocking: [
          {
            rule: "NIGHT_REST",
            severity: "error",
            nurseId: N1,
            nightDate: "2026-10-24",
            date: "2026-10-25",
            shift: "M",
          },
        ],
      },
    ]);
  });

  it("blocks a Night before an existing next-day shift", () => {
    const result = evaluate({
      nurseIds: [N1],
      assignments: [a(N1, "2026-10-26", "E")],
    });
    expect(result.notAllowed[0]!.blocking).toMatchObject([
      { rule: "NIGHT_REST", nightDate: "2026-10-25", date: "2026-10-26" },
    ]);
  });

  it("uses the previous schedule's boundary day (D20)", () => {
    const result = evaluate({
      date: period.start,
      shift: "E",
      nurseIds: [N1, N2],
      adjacentAssignments: [a(N1, "2026-10-22", "N")],
    });
    expect(ids(result.available)).toEqual([N2]);
    expect(result.notAllowed[0]!.blocking).toMatchObject([
      { rule: "NIGHT_REST", nightDate: "2026-10-22", date: "2026-10-23" },
    ]);
  });

  it("uses the next schedule's boundary day (D20)", () => {
    const result = evaluate({
      date: period.end,
      shift: "N",
      nurseIds: [N1, N2],
      adjacentAssignments: [
        a(N1, "2026-11-22", "M"),
        a(N2, "2026-11-22", "OFF"),
      ],
    });
    expect(ids(result.available)).toEqual([N2]);
    expect(result.notAllowed[0]!.blocking).toMatchObject([
      { rule: "NIGHT_REST", nightDate: "2026-11-21", date: "2026-11-22" },
    ]);
  });

  it("makes a configured staffing maximum Not Allowed (existing rule, D102)", () => {
    const staffingRequirements = new Map<IsoDate, StaffingRequirement>([
      [DAY, { N: { max: 1 } }],
    ]);
    const result = evaluate({
      nurseIds: [N1, N2],
      assignments: [a(N2, "2026-10-25", "N")],
      staffingRequirements,
    });
    expect(result.notAllowed).toMatchObject([
      {
        nurseId: N1,
        blocking: [
          {
            rule: "STAFFING",
            period: "N",
            covered: 2,
            status: "ABOVE_MAXIMUM",
            bounds: { max: 1 },
          },
        ],
      },
    ]);
  });

  it("does not block a shortage the assignment only reduces", () => {
    const result = evaluate({
      nurseIds: [N1],
      staffingRequirements: new Map([[DAY, { N: { min: 3 } }]]),
    });
    expect(ids(result.available)).toEqual([N1]);
  });

  it("keeps every blocking finding of one candidate", () => {
    const result = evaluate({
      nurseIds: [N1],
      assignments: [
        a(N1, "2026-10-24", "N"),
        a(N1, "2026-10-26", "M"),
        a(N2, "2026-10-25", "N"),
      ],
      staffingRequirements: new Map([[DAY, { N: { max: 1 } }]]),
    });
    expect(
      result.notAllowed[0]!.blocking.map((v) => [v.rule, v.date]),
      // In the validator's order: by date, a period finding before a nurse's.
    ).toEqual([
      ["STAFFING", "2026-10-25"],
      ["NIGHT_REST", "2026-10-25"],
      ["NIGHT_REST", "2026-10-26"],
    ]);
  });

  it("reports exactly the shared assessment's blocking findings", () => {
    const context = {
      period,
      assignments: [
        a(N1, "2026-10-24", "N"),
        a(N1, "2026-10-25", "OFF"),
        a(N1, "2026-10-26", "E"),
      ],
      adjacentAssignments: [],
      staffingRequirements: new Map([[DAY, { N: { min: 2, max: 2 } }]]),
    };
    const result = evaluate({ ...context, nurseIds: [N1] });
    // The OFF decision is replaced by the shift in its own cell.
    const shared = assessEdits({
      ...context,
      edits: [{ nurseId: N1, date: DAY, shift: "N" }],
    });
    expect(shared.assessment.blocked).toBe(true);
    expect(result.notAllowed[0]!.blocking).toEqual(shared.assessment.blocking);
  });
});

describe("Not Allowed ordering: users.id only", () => {
  it("ignores preference, day status and the number or kind of findings", () => {
    const result = evaluate({
      shift: "M",
      nurseIds: [N4, N2, N3, N1],
      assignments: [
        // N1: night rest + staffing, OFF decision, OFF wish.
        a(N1, "2026-10-24", "N"),
        a(N1, "2026-10-25", "OFF"),
        // N2: one staffing finding, same-shift wish.
        // N3: night rest + staffing, unassigned.
        a(N3, "2026-10-24", "N"),
        // N4: night rest + staffing, OFF decision, same-shift wish.
        a(N4, "2026-10-24", "N"),
        a(N4, "2026-10-25", "OFF"),
        a(N5, "2026-10-25", "M"),
      ],
      staffingRequirements: new Map([[DAY, { M: { max: 1 } }]]),
      preferences: prefs([
        [N1, "OFF"],
        [N2, "M"],
        [N4, "M"],
      ]),
    });
    expect(result.available).toEqual([]);
    expect(ids(result.notAllowed)).toEqual([N1, N2, N3, N4]);
    expect(result.notAllowed.map((c) => c.blocking.length)).toEqual([
      2, 1, 2, 2,
    ]);
  });
});

describe("OFF decisions", () => {
  it("offers an OFF nurse who passes the rules, flagged for replacement", () => {
    const result = evaluate({
      nurseIds: [N1, N2],
      assignments: [a(N1, "2026-10-25", "OFF")],
    });
    expect(result.available).toEqual([
      expect.objectContaining({ nurseId: N2, requiresOffReplacement: false }),
      expect.objectContaining({
        nurseId: N1,
        dayStatus: "OFF_ASSIGNMENT",
        requiresOffReplacement: true,
      }),
    ]);
  });

  it("assesses the OFF → shift replacement: OFF after a Night is fine, a shift is not", () => {
    const result = evaluate({
      shift: "E",
      nurseIds: [N1],
      assignments: [a(N1, "2026-10-24", "N"), a(N1, "2026-10-25", "OFF")],
    });
    expect(result.notAllowed).toMatchObject([
      {
        nurseId: N1,
        dayStatus: "OFF_ASSIGNMENT",
        blocking: [{ rule: "NIGHT_REST", shift: "E" }],
      },
    ]);
  });
});

describe("purity and determinism", () => {
  function scenario(): CandidateEvaluationInput {
    return input({
      shift: "N",
      nurseIds: [N3, N1, N2, N4],
      assignments: [
        a(N1, "2026-10-25", "OFF"),
        a(N2, "2026-10-24", "N"),
        a(N2, "2026-10-26", "M"),
        a(N4, "2026-10-25", "E"),
      ],
      // A boundary Night far from the target day: context only, no finding.
      adjacentAssignments: [a(N3, "2026-10-22", "N")],
      staffingRequirements: new Map([[DAY, { N: { min: 2, max: 3 } }]]),
      preferences: prefs([
        [N1, "N"],
        [N3, "OFF"],
      ]),
    });
  }

  /** Deeply frozen arrays and items: any mutation throws. */
  function frozen(value: CandidateEvaluationInput): CandidateEvaluationInput {
    const freeze = <T extends object>(items: readonly T[]) =>
      Object.freeze(items.map((item) => Object.freeze({ ...item })));
    return Object.freeze({
      ...value,
      nurseIds: Object.freeze([...value.nurseIds]),
      assignments: freeze(value.assignments),
      adjacentAssignments: freeze(value.adjacentAssignments),
    });
  }

  const snapshot = (value: CandidateEvaluationInput) => ({
    ...structuredClone({
      ...value,
      staffingRequirements: null,
      preferences: null,
    }),
    staffingRequirements: structuredClone([...value.staffingRequirements]),
    preferences: [...value.preferences],
  });

  it("mutates no input: assignments, adjacent days, preferences, requirements", () => {
    const value = frozen(scenario());
    const before = snapshot(value);
    evaluate(value);
    expect(snapshot(value)).toEqual(before);
  });

  it("evaluates every candidate against the same unchanged baseline", () => {
    // With room for one more Night, each candidate alone fits; assigning
    // them one after another would put the second over the maximum.
    const result = evaluate({
      nurseIds: [N1, N2, N3],
      assignments: [a(N4, "2026-10-25", "N")],
      staffingRequirements: new Map([[DAY, { N: { max: 2 } }]]),
    });
    expect(ids(result.available)).toEqual([N1, N2, N3]);
    expect(result.notAllowed).toEqual([]);
  });

  it("returns structurally identical results for identical or reordered inputs", () => {
    const first = evaluate(scenario());
    expect(evaluate(scenario())).toEqual(first);
    const shuffled = scenario();
    const reordered: CandidateEvaluation = evaluate({
      ...shuffled,
      nurseIds: [...shuffled.nurseIds].reverse(),
      assignments: [...shuffled.assignments].reverse(),
      preferences: new Map([...shuffled.preferences].reverse()),
    });
    expect(reordered).toEqual(first);
    expect(first).toMatchObject({
      available: [
        { nurseId: N3, dayStatus: "UNASSIGNED", preference: "OFF_PREFERENCE" },
        { nurseId: N1, dayStatus: "OFF_ASSIGNMENT", preference: "SAME_SHIFT" },
      ],
      notAllowed: [{ nurseId: N2 }],
    });
  });
});
