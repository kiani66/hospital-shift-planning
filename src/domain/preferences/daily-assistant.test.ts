import { describe, expect, it, vi } from "vitest";

import type { MembershipRole } from "../authz/actor";
import * as assessmentModule from "../schedule/assess-edits";
import { isoDate, addDays } from "../shared/dates";
import type { Assignment } from "../shifts/assignment";
import {
  ASSIGNMENT_CODES,
  SHIFT_CODES,
  type AssignmentCode,
  type PreferenceValue,
} from "../shifts/shift-type";
import type { RuleSetContent } from "../staffing-rules/model";
import {
  planDailyPreferences,
  type DailyPreferencePlanInput,
} from "./daily-assistant";

const date = isoDate("2026-10-24");
const period = { start: isoDate("2026-10-23"), end: isoDate("2026-11-21") };
const rules: RuleSetContent = {
  normal: {
    M: { min: 0, max: null },
    E: { min: 0, max: null },
    N: { min: 0, max: null },
  },
  holiday: {},
  exceptions: [],
};
const pref = (userId: string, value: PreferenceValue, on = date) => ({
  userId,
  date: on,
  value,
});
const assignment = (
  nurseId: string,
  shift: AssignmentCode,
  on = date,
): Assignment => ({ nurseId, date: on, shift });
const member = (userId: string, role: MembershipRole = "NURSE") => ({
  userId,
  role,
  isActive: true,
  startedOn: period.start,
  endedOn: null,
});
function fixture(
  preferences = [pref("n", "M")],
  overrides: Partial<DailyPreferencePlanInput> = {},
): DailyPreferencePlanInput {
  const ids = [...new Set(preferences.map((p) => p.userId))];
  return {
    date,
    period,
    preferences,
    assignments: [],
    roster: ids.map((userId) => ({ userId, role: "NURSE" })),
    members: ids.map((id) => member(id)),
    staffingRuleSet: { versionId: "pinned-v1", content: rules },
    holidays: new Set(),
    adjacentAssignments: [],
    ...overrides,
  };
}
const withBounds = (normal: Partial<RuleSetContent["normal"]>) => ({
  staffingRuleSet: {
    versionId: "pinned-v2",
    content: { ...rules, normal: { ...rules.normal, ...normal } },
  },
});
const group = (
  plan: ReturnType<typeof planDailyPreferences>,
  shift: (typeof SHIFT_CODES)[number],
) => plan.groups.find((g) => g.shift === shift)!;
const bucket = (
  plan: ReturnType<typeof planDailyPreferences>,
  shift: "M" | "E" | "N",
) => plan.coverage.find((b) => b.period === shift)!;

describe("daily preference suggestions", () => {
  it("returns every selected-day preference in exact M/E/N/ME groups or informational OFF", () => {
    const input = fixture([
      pref("m", "M"),
      pref("e", "E"),
      pref("n", "N"),
      pref("me", "ME"),
      pref("off", "OFF"),
      pref("tomorrow", "M", addDays(date, 1)),
    ]);
    const plan = planDailyPreferences(input);
    expect(
      plan.groups.map((g) => [g.shift, g.suggestions.map((r) => r.nurseId)]),
    ).toEqual([
      ["M", ["m"]],
      ["E", ["e"]],
      ["N", ["n"]],
      ["ME", ["me"]],
    ]);
    expect(plan.proposed).toEqual([
      assignment("m", "M"),
      assignment("e", "E"),
      assignment("n", "N"),
      assignment("me", "ME"),
    ]);
    expect(plan.offPreferences).toEqual([
      {
        nurseId: "off",
        date,
        preference: "OFF",
        currentAssignment: null,
        status: "INFORMATIONAL",
        reason: "OFF_PREFERENCE",
        assessment: null,
      },
    ]);
    expect(plan.staffingRuleSetVersionId).toBe("pinned-v1");
  });

  it.each(SHIFT_CODES)(
    "marks an existing %s as ALREADY_ASSIGNED without proposing a rewrite",
    (shift) => {
      const plan = planDailyPreferences(
        fixture([pref("n", shift)], { assignments: [assignment("n", shift)] }),
      );
      expect(group(plan, shift).suggestions[0]).toMatchObject({
        status: "ALREADY_ASSIGNED",
        currentAssignment: shift,
        reason: null,
        assessment: null,
      });
      expect(plan.proposed).toEqual([]);
      expect(bucket(plan, shift === "ME" ? "M" : shift).eligibleDemand).toBe(0);
    },
  );

  it.each(ASSIGNMENT_CODES)(
    "preserves a different existing %s decision, including OFF and H",
    (shift) => {
      const preference = shift === "M" ? "E" : "M";
      const stored = [assignment("n", shift)];
      const plan = planDailyPreferences(
        fixture([pref("n", preference)], { assignments: stored }),
      );
      expect(group(plan, preference).suggestions[0]).toMatchObject({
        status: "CONFLICT",
        reason: "EXISTING_ASSIGNMENT",
        currentAssignment: shift,
        assessment: null,
      });
      expect(plan.proposed).toEqual([]);
      expect(stored).toEqual([assignment("n", shift)]);
    },
  );

  it.each(["OFF", "H", "N"] as const)(
    "keeps an OFF preference informational beside an existing %s",
    (shift) => {
      const plan = planDailyPreferences(
        fixture([pref("n", "OFF")], { assignments: [assignment("n", shift)] }),
      );
      expect(plan.offPreferences[0]).toMatchObject({
        status: "INFORMATIONAL",
        currentAssignment: shift,
      });
      expect(plan.proposed).toEqual([]);
    },
  );

  it("returns an empty plan without clearing assignments and retains shortage information", () => {
    const plan = planDailyPreferences(
      fixture([], {
        ...withBounds({ M: { min: 2, max: 4 } }),
        roster: [{ userId: "existing", role: "NURSE" }],
        assignments: [assignment("existing", "M")],
      }),
    );
    expect(plan.groups.every((g) => g.suggestions.length === 0)).toBe(true);
    expect(plan.offPreferences).toEqual([]);
    expect(plan.proposed).toEqual([]);
    expect(bucket(plan, "M")).toMatchObject({
      current: 1,
      currentShortage: 1,
      remainingShortage: 1,
    });
    expect(plan.assessment.blocked).toBe(false);
  });

  it.each(
    [
      [],
      [member("other")],
      [{ ...member("n"), isActive: false }],
      [{ ...member("n"), startedOn: addDays(date, 1) }],
      [{ ...member("n"), endedOn: addDays(date, -1) }],
    ].map((members) => ({ members })),
  )(
    "shows inactive or invalid dated membership as a conflict (%j)",
    ({ members }) => {
      const plan = planDailyPreferences(fixture(undefined, { members }));
      expect(group(plan, "M").suggestions[0]).toMatchObject({
        status: "CONFLICT",
        reason: "INACTIVE_OR_NOT_MEMBER",
      });
      expect(plan.proposed).toEqual([]);
      expect(bucket(plan, "M").eligibleDemand).toBe(0);
    },
  );

  it("requires roster membership even when department membership is valid", () => {
    const plan = planDailyPreferences(fixture(undefined, { roster: [] }));
    expect(group(plan, "M").suggestions[0]?.reason).toBe("NOT_ON_ROSTER");
    expect(plan.proposed).toEqual([]);
  });

  it("uses inclusive membership dates and schedules Head Nurses as nurses", () => {
    const plan = planDailyPreferences(
      fixture(undefined, {
        roster: [{ userId: "n", role: "HEAD_NURSE" }],
        members: [
          { ...member("n", "HEAD_NURSE"), startedOn: date, endedOn: date },
        ],
      }),
    );
    expect(plan.proposed).toEqual([assignment("n", "M")]);
  });

  it.each(["roster", "membership"] as const)(
    "keeps secretary preferences informational when the %s role is SECRETARY",
    (where) => {
      const plan = planDailyPreferences(
        fixture([pref("nurse", "M"), pref("secretary", "M")], {
          roster: [
            { userId: "nurse", role: "NURSE" },
            {
              userId: "secretary",
              role: where === "roster" ? "SECRETARY" : "NURSE",
            },
          ],
          members: [
            member("nurse"),
            member("secretary", where === "membership" ? "SECRETARY" : "NURSE"),
          ],
          ...withBounds({ M: { min: 0, max: 1 } }),
        }),
      );
      expect(
        group(plan, "M").suggestions.find((r) => r.nurseId === "secretary"),
      ).toMatchObject({
        status: "INFORMATIONAL",
        reason: "NON_NURSING_PREFERENCE",
      });
      expect(bucket(plan, "M").eligibleDemand).toBe(1);
      expect(plan.proposed).toEqual([assignment("nurse", "M")]);
    },
  );

  it("excludes already scheduled secretaries from nursing coverage", () => {
    const plan = planDailyPreferences(
      fixture([pref("nurse", "M"), pref("secretary", "ME")], {
        roster: [
          { userId: "nurse", role: "NURSE" },
          { userId: "secretary", role: "SECRETARY" },
        ],
        members: [member("nurse"), member("secretary", "SECRETARY")],
        assignments: [assignment("secretary", "ME")],
        ...withBounds({ M: { min: 0, max: 1 } }),
      }),
    );
    expect(bucket(plan, "M")).toMatchObject({
      current: 0,
      eligibleDemand: 1,
      proposed: 1,
    });
    expect(bucket(plan, "E").current).toBe(0);
    expect(plan.proposed).toEqual([assignment("nurse", "M")]);
  });
});

describe("capacity without nurse or group priority", () => {
  it("accepts demand exactly equal to remaining maximum capacity", () => {
    const plan = planDailyPreferences(
      fixture([pref("a", "M"), pref("b", "M"), pref("old", "M")], {
        assignments: [assignment("old", "M")],
        ...withBounds({ M: { min: 1, max: 3 } }),
      }),
    );
    expect(plan.proposed).toEqual([assignment("a", "M"), assignment("b", "M")]);
    expect(bucket(plan, "M")).toMatchObject({
      current: 1,
      minimum: 1,
      maximum: 3,
      eligibleDemand: 2,
      availableCapacity: 2,
      contention: false,
      proposed: 3,
    });
  });

  it("never chooses the first nurse when demand exceeds capacity", () => {
    const plan = planDailyPreferences(
      fixture(
        [pref("z", "M"), pref("a", "M")],
        withBounds({ M: { min: 0, max: 1 } }),
      ),
    );
    expect(plan.proposed).toEqual([]);
    expect(group(plan, "M").manualSelectionRequired).toBe(true);
    expect(
      group(plan, "M").suggestions.every((r) => r.status === "ELIGIBLE"),
    ).toBe(true);
    expect(plan.skippedGroups).toContainEqual({
      shift: "M",
      reason: "CAPACITY_CONTENTION",
      contentionPeriods: ["M"],
    });
    expect(bucket(plan, "M")).toMatchObject({
      eligibleDemand: 2,
      availableCapacity: 1,
      contention: true,
      proposed: 0,
    });
  });

  it("reports zero maximum as both an individual rule conflict and capacity contention", () => {
    const plan = planDailyPreferences(
      fixture(undefined, withBounds({ M: { min: 0, max: 0 } })),
    );
    expect(group(plan, "M").suggestions[0]).toMatchObject({
      status: "CONFLICT",
      reason: "RULE_VIOLATION",
      assessment: {
        blocking: [
          expect.objectContaining({
            rule: "STAFFING",
            status: "ABOVE_MAXIMUM",
          }),
        ],
      },
    });
    expect(group(plan, "M").manualSelectionRequired).toBe(true);
    expect(bucket(plan, "M")).toMatchObject({
      maximum: 0,
      availableCapacity: 0,
      eligibleDemand: 1,
    });
    expect(plan.proposed).toEqual([]);
  });

  it("treats missing maximum as unlimited", () => {
    const plan = planDailyPreferences(
      fixture(Array.from({ length: 120 }, (_, i) => pref(String(i), "M"))),
    );
    expect(plan.proposed).toHaveLength(120);
    expect(bucket(plan, "M")).toMatchObject({
      maximum: null,
      availableCapacity: null,
      contention: false,
      proposed: 120,
    });
  });

  it("counts an existing ME once in each operational bucket and new ME demand in both", () => {
    const plan = planDailyPreferences(
      fixture([pref("old", "ME"), pref("new", "ME")], {
        assignments: [assignment("old", "ME")],
        ...withBounds({ M: { min: 0, max: 2 }, E: { min: 0, max: 2 } }),
      }),
    );
    expect(plan.proposed).toEqual([assignment("new", "ME")]);
    for (const p of ["M", "E"] as const)
      expect(bucket(plan, p)).toMatchObject({
        current: 1,
        eligibleDemand: 1,
        proposed: 2,
      });
    expect(plan.coverage.map((b) => b.period)).toEqual(["M", "E", "N"]);
  });

  it.each(["M", "E"] as const)(
    "leaves both %s and ME unchanged under shared capacity contention, while independent groups proceed",
    (p) => {
      const other = p === "M" ? "E" : "M";
      const plan = planDailyPreferences(
        fixture(
          [
            pref("short", p),
            pref("long", "ME"),
            pref("night", "N"),
            pref("other", other),
          ],
          withBounds({ [p]: { min: 0, max: 1 } }),
        ),
      );
      expect(group(plan, p).manualSelectionRequired).toBe(true);
      expect(group(plan, "ME").manualSelectionRequired).toBe(true);
      expect(plan.proposed).toEqual([
        assignment("other", other),
        assignment("night", "N"),
      ]);
      expect(
        plan.skippedGroups
          .filter((s) => s.reason === "CAPACITY_CONTENTION")
          .map((s) => s.shift),
      ).toEqual(SHIFT_CODES.filter((s) => s === p || s === "ME"));
      expect(bucket(plan, p).eligibleDemand).toBe(2);
    },
  );

  it("marks M, E and ME when both shared buckets contend", () => {
    const plan = planDailyPreferences(
      fixture(
        [pref("m", "M"), pref("e", "E"), pref("me", "ME"), pref("n", "N")],
        withBounds({ M: { min: 0, max: 1 }, E: { min: 0, max: 1 } }),
      ),
    );
    expect(plan.proposed).toEqual([assignment("n", "N")]);
    expect(plan.skippedGroups).toContainEqual({
      shift: "ME",
      reason: "CAPACITY_CONTENTION",
      contentionPeriods: ["M", "E"],
    });
  });

  it("keeps ME indivisible when only its Evening coverage would exceed capacity", () => {
    const plan = planDailyPreferences(
      fixture(
        [pref("me", "ME"), pref("m", "M")],
        withBounds({ E: { min: 0, max: 0 } }),
      ),
    );
    expect(plan.proposed).toEqual([assignment("m", "M")]);
    expect(group(plan, "ME").suggestions[0]?.status).toBe("CONFLICT");
    expect(bucket(plan, "M").eligibleDemand).toBe(2);
  });

  it("does not let a session rejection resolve an oversubscribed group", () => {
    const input = fixture([pref("a", "M"), pref("b", "M")], {
      ...withBounds({ M: { min: 0, max: 1 } }),
      excludedNurseIds: new Set(["b"]),
    });
    const plan = planDailyPreferences(input);
    expect(plan.proposed).toEqual([]);
    expect(bucket(plan, "M").eligibleDemand).toBe(2);
    expect(group(plan, "M").manualSelectionRequired).toBe(true);
    expect(group(plan, "M").suggestions).toEqual(
      group(
        planDailyPreferences({ ...input, excludedNurseIds: undefined }),
        "M",
      ).suggestions,
    );
  });

  it("honors session exclusions in safe groups without persisting rejection state", () => {
    const input = fixture([pref("a", "M"), pref("b", "M"), pref("e", "E")], {
      excludedNurseIds: new Set(["b", "e", "unknown"]),
    });
    const plan = planDailyPreferences(input);
    expect(plan.proposed).toEqual([assignment("a", "M")]);
    expect(plan.skippedGroups).toContainEqual({
      shift: "E",
      reason: "SESSION_EXCLUDED",
      contentionPeriods: [],
    });
    expect(bucket(plan, "M").eligibleDemand).toBe(2);
    expect(
      planDailyPreferences({ ...input, excludedNurseIds: undefined }).proposed,
    ).toHaveLength(3);
  });

  it("uses the pinned version's Exception > Holiday > Normal resolution", () => {
    const input = fixture([pref("m", "M"), pref("e", "E"), pref("n", "N")], {
      staffingRuleSet: {
        versionId: "old-pinned",
        content: {
          ...rules,
          holiday: { M: { min: 0, max: 0 }, E: { min: 0, max: 0 } },
          exceptions: [
            { date, period: "M", bounds: { min: 0, max: 1 }, note: null },
          ],
        },
      },
      holidays: new Set([date]),
    });
    const plan = planDailyPreferences(input);
    expect(plan.staffingRuleSetVersionId).toBe("old-pinned");
    expect(bucket(plan, "M")).toMatchObject({
      source: "EXCEPTION",
      maximum: 1,
    });
    expect(bucket(plan, "E")).toMatchObject({ source: "HOLIDAY", maximum: 0 });
    expect(bucket(plan, "N")).toMatchObject({
      source: "NORMAL",
      maximum: null,
    });
    expect(plan.proposed).toEqual([assignment("m", "M"), assignment("n", "N")]);
  });
});

describe("shared hard-rule assessment", () => {
  it.each(SHIFT_CODES)(
    "blocks %s after an existing Night with the original structured finding",
    (shift) => {
      const plan = planDailyPreferences(
        fixture([pref("n", shift)], {
          assignments: [assignment("n", "N", addDays(date, -1))],
        }),
      );
      expect(group(plan, shift).suggestions[0]).toMatchObject({
        status: "CONFLICT",
        reason: "RULE_VIOLATION",
        assessment: {
          blocking: [
            {
              rule: "NIGHT_REST",
              severity: "error",
              nurseId: "n",
              nightDate: addDays(date, -1),
              date,
              shift,
            },
          ],
        },
      });
      expect(plan.proposed).toEqual([]);
      expect(bucket(plan, shift === "ME" ? "M" : shift).eligibleDemand).toBe(0);
    },
  );

  it("blocks a Night before an existing next-day shift", () => {
    const plan = planDailyPreferences(
      fixture([pref("n", "N")], {
        assignments: [assignment("n", "E", addDays(date, 1))],
      }),
    );
    expect(group(plan, "N").suggestions[0]?.assessment?.blocking).toEqual([
      expect.objectContaining({
        rule: "NIGHT_REST",
        nightDate: date,
        date: addDays(date, 1),
        shift: "E",
      }),
    ]);
    expect(plan.proposed).toEqual([]);
  });

  it("checks the previous month's Night for a nurse with no assignment this month", () => {
    const on = period.start;
    const plan = planDailyPreferences(
      fixture([pref("n", "ME", on)], {
        date: on,
        adjacentAssignments: [assignment("n", "N", addDays(on, -1))],
      }),
    );
    expect(group(plan, "ME").suggestions[0]?.assessment?.blocking).toEqual([
      expect.objectContaining({
        rule: "NIGHT_REST",
        date: on,
        nightDate: addDays(on, -1),
      }),
    ]);
    expect(plan.proposed).toEqual([]);
  });

  it("checks next month's first day before proposing a last-day Night", () => {
    const on = period.end;
    const plan = planDailyPreferences(
      fixture([pref("n", "N", on)], {
        date: on,
        adjacentAssignments: [assignment("n", "M", addDays(on, 1))],
      }),
    );
    expect(group(plan, "N").suggestions[0]?.assessment?.blocking).toEqual([
      expect.objectContaining({
        rule: "NIGHT_REST",
        date: addDays(on, 1),
        nightDate: on,
      }),
    ]);
    expect(plan.proposed).toEqual([]);
  });

  it("allows an independent insertion despite unrelated pre-existing night-rest violations", () => {
    const plan = planDailyPreferences(
      fixture(undefined, {
        assignments: [
          assignment("other", "N", addDays(date, -1)),
          assignment("other", "M"),
        ],
      }),
    );
    expect(plan.proposed).toEqual([assignment("n", "M")]);
    expect(plan.assessment.blocked).toBe(false);
  });

  it("permits an independent bucket while existing excess remains unchanged", () => {
    const plan = planDailyPreferences(
      fixture([pref("n", "E"), pref("old1", "M"), pref("old2", "M")], {
        assignments: [assignment("old1", "M"), assignment("old2", "M")],
        ...withBounds({ M: { min: 0, max: 1 } }),
      }),
    );
    expect(plan.proposed).toEqual([assignment("n", "E")]);
    expect(plan.assessment.persisting).toContainEqual(
      expect.objectContaining({
        rule: "STAFFING",
        status: "ABOVE_MAXIMUM",
        period: "M",
      }),
    );
    expect(group(plan, "E").manualSelectionRequired).toBe(false);
  });

  it("allows assignments below minimum and reports the remaining shortage with error severity intact", () => {
    const plan = planDailyPreferences(
      fixture(
        undefined,
        withBounds({ M: { min: 3, max: 4 }, E: { min: 2, max: null } }),
      ),
    );
    expect(plan.proposed).toEqual([assignment("n", "M")]);
    expect(bucket(plan, "M")).toMatchObject({
      currentShortage: 3,
      remainingShortage: 2,
    });
    expect(bucket(plan, "E")).toMatchObject({
      currentShortage: 2,
      remainingShortage: 2,
    });
    expect(plan.assessment.persisting).toContainEqual(
      expect.objectContaining({
        rule: "STAFFING",
        severity: "error",
        status: "BELOW_MINIMUM",
        covered: 1,
      }),
    );
    expect(plan.assessment.blocked).toBe(false);
  });

  it("assesses the entire proposed batch together, not just each nurse independently", () => {
    const spy = vi.spyOn(assessmentModule, "assessEdits");
    const input = fixture([pref("a", "M"), pref("b", "ME"), pref("c", "N")]);
    const plan = planDailyPreferences(input);
    expect(spy).toHaveBeenLastCalledWith(
      expect.objectContaining({ edits: plan.proposed }),
    );
    expect(plan.proposed).toHaveLength(3);
    expect(plan.assessment.blocked).toBe(false);
  });

  it("refuses the complete batch if a shared rule finds an aggregate hard conflict", () => {
    // Current cross-nurse conflicts are capacity, handled before batch assembly.
    // Inject an aggregate finding to verify the fail-closed guard for future rules.
    const original = assessmentModule.assessEdits;
    vi.spyOn(assessmentModule, "assessEdits").mockImplementation((input) => {
      const result = original(input);
      if (input.edits.length < 2) return result;
      const finding = {
        rule: "STAFFING" as const,
        severity: "error" as const,
        date,
        period: "M" as const,
        covered: 2,
        status: "ABOVE_MAXIMUM" as const,
        bounds: { max: 1 },
      };
      return {
        ...result,
        assessment: {
          introduced: [finding],
          blocking: [finding],
          warnings: [],
          persisting: [],
          blocked: true,
        },
      };
    });
    const plan = planDailyPreferences(
      fixture([pref("a", "M"), pref("b", "ME")]),
    );
    expect(plan.proposed).toEqual([]);
    expect(plan.assessment.blocked).toBe(true);
    expect(
      plan.skippedGroups
        .filter((s) => s.reason === "BATCH_RULE_CONFLICT")
        .map((s) => s.shift),
    ).toEqual(["M", "ME"]);
    expect(bucket(plan, "M").proposed).toBe(0);
  });

  it("does not count rest-blocked nurses as eligible capacity demand", () => {
    const plan = planDailyPreferences(
      fixture([pref("free", "M"), pref("blocked", "M")], {
        assignments: [assignment("blocked", "N", addDays(date, -1))],
        ...withBounds({ M: { min: 0, max: 1 } }),
      }),
    );
    expect(plan.proposed).toEqual([assignment("free", "M")]);
    expect(bucket(plan, "M").eligibleDemand).toBe(1);
  });
});

describe("determinism, input integrity and purity", () => {
  it("rejects a target outside the schedule period", () => {
    expect(() =>
      planDailyPreferences(
        fixture(undefined, { date: addDays(period.end, 1) }),
      ),
    ).toThrow("outside the schedule period");
  });
  it("rejects duplicate preferences without choosing a value by input order", () => {
    expect(() =>
      planDailyPreferences(fixture([pref("n", "M"), pref("n", "E")])),
    ).toThrow("Duplicate daily preference");
  });
  it("rejects duplicate roster identities without choosing a role by input order", () => {
    expect(() =>
      planDailyPreferences(
        fixture(undefined, {
          roster: [
            { userId: "n", role: "NURSE" },
            { userId: "n", role: "SECRETARY" },
          ],
        }),
      ),
    ).toThrow("Duplicate roster member");
  });
  it.each(
    [
      [assignment("n", "M"), assignment("n", "E")],
      [assignment("n", "M", addDays(period.end, 1))],
    ].map((assignments) => ({ assignments })),
  )(
    "rejects ambiguous or out-of-period working assignments (%j)",
    ({ assignments }) => {
      expect(() =>
        planDailyPreferences(fixture(undefined, { assignments })),
      ).toThrow("Invalid assignment structure");
    },
  );

  it("produces identical complete output under independent permutations of all collections", () => {
    const input = fixture(
      [
        pref("m1", "M"),
        pref("m2", "M"),
        pref("me", "ME"),
        pref("e", "E"),
        pref("n", "N"),
        pref("off", "OFF"),
        pref("old", "E"),
        pref("rest", "ME"),
      ],
      {
        ...withBounds({ M: { min: 0, max: 1 } }),
        assignments: [
          assignment("old", "E"),
          assignment("rest", "N", addDays(date, -1)),
        ],
        adjacentAssignments: [
          assignment("m1", "OFF", addDays(period.start, -1)),
          assignment("me", "OFF", addDays(period.end, 1)),
        ],
        holidays: new Set([date, period.end]),
        excludedNurseIds: new Set(["n", "off"]),
      },
    );
    const baseline = planDailyPreferences(input);
    for (let mask = 0; mask < 128; mask++) {
      const plan = planDailyPreferences({
        ...input,
        preferences:
          mask & 1 ? input.preferences.toReversed() : input.preferences,
        assignments:
          mask & 2 ? input.assignments.toReversed() : input.assignments,
        roster: mask & 4 ? input.roster.toReversed() : input.roster,
        members: mask & 8 ? input.members.toReversed() : input.members,
        adjacentAssignments:
          mask & 16
            ? input.adjacentAssignments.toReversed()
            : input.adjacentAssignments,
        holidays:
          mask & 32 ? new Set([...input.holidays].reverse()) : input.holidays,
        excludedNurseIds:
          mask & 64
            ? new Set([...input.excludedNurseIds!].reverse())
            : input.excludedNurseIds,
      });
      expect(plan).toEqual(baseline);
    }
  });

  it("does not mutate frozen inputs", () => {
    const input = fixture([pref("b", "ME"), pref("a", "M")], {
      assignments: [assignment("a", "OFF")],
    });
    const before = structuredClone(input);
    for (const list of [
      input.preferences,
      input.assignments,
      input.roster,
      input.members,
      input.adjacentAssignments,
    ]) {
      list.forEach(Object.freeze);
      Object.freeze(list);
    }
    Object.freeze(input.staffingRuleSet.content.normal);
    Object.freeze(input);
    planDailyPreferences(input);
    expect(input).toEqual(before);
  });
});
