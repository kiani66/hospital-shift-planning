import { describe, expect, it } from "vitest";
import { isoDate } from "../shared/dates";
import type { Assignment } from "../shifts/assignment";
import { PREFERENCE_VALUES } from "../shifts/shift-type";
import { planMonthlyPreferences } from "./apply-monthly";

const date = isoDate("2026-10-24");
const base = {
  status: "DRAFT" as const,
  period: { start: isoDate("2026-10-23"), end: isoDate("2026-11-21") },
  preferences: [{ userId: "n", date, value: "M" as const }],
  assignments: [] as Assignment[],
  rosterNurseIds: new Set(["n"]),
  members: [{ userId: "n", isActive: true, startedOn: date, endedOn: null }],
};

describe("current monthly preference replacement", () => {
  it("plans the same replacements in PLANNING", () => {
    expect(planMonthlyPreferences({ ...base, status: "PLANNING" })).toEqual(
      planMonthlyPreferences(base),
    );
  });
  it.each(PREFERENCE_VALUES)("applies %s as one cell", (value) => {
    expect(
      planMonthlyPreferences({
        ...base,
        preferences: [{ userId: "n", date, value }],
      }),
    ).toEqual({
      changes: [{ nurseId: "n", date, before: null, after: value }],
      skipped: [],
      unchangedCount: 0,
    });
  });
  it("replaces existing/manual decisions and leaves unrelated cells alone", () => {
    expect(
      planMonthlyPreferences({
        ...base,
        assignments: [
          { nurseId: "n", date, shift: "OFF" },
          { nurseId: "n", date: isoDate("2026-10-25"), shift: "E" },
        ],
      }).changes,
    ).toEqual([{ nurseId: "n", date, before: "OFF", after: "M" }]);
  });
  it("does not rewrite an equal decision", () => {
    expect(
      planMonthlyPreferences({
        ...base,
        assignments: [{ nurseId: "n", date, shift: "M" }],
      }),
    ).toEqual({
      changes: [],
      skipped: [],
      unchangedCount: 1,
    });
  });
  it("does not delete assignments when preferences are absent", () => {
    expect(
      planMonthlyPreferences({
        ...base,
        preferences: [],
        assignments: [{ nurseId: "n", date, shift: "M" }],
      }),
    ).toEqual({ changes: [], skipped: [], unchangedCount: 0 });
  });
  it.each([
    [
      { period: { start: isoDate("2026-10-25"), end: base.period.end } },
      "OUTSIDE_PERIOD",
    ],
    [{ rosterNurseIds: new Set<string>() }, "NOT_ON_ROSTER"],
    [{ members: [] }, "INACTIVE_OR_NOT_MEMBER"],
    [
      { members: [{ ...base.members[0]!, isActive: false }] },
      "INACTIVE_OR_NOT_MEMBER",
    ],
    [
      { members: [{ ...base.members[0]!, userId: "other" }] },
      "INACTIVE_OR_NOT_MEMBER",
    ],
    [
      { members: [{ ...base.members[0]!, startedOn: isoDate("2026-10-25") }] },
      "INACTIVE_OR_NOT_MEMBER",
    ],
    [
      { members: [{ ...base.members[0]!, endedOn: isoDate("2026-10-23") }] },
      "INACTIVE_OR_NOT_MEMBER",
    ],
    [
      { assignments: [{ nurseId: "n", date, shift: "H" as const }] },
      "LEAVE_PRESERVED",
    ],
  ] as const)("reports an excluded cell (%s)", (overrides, reason) => {
    expect(planMonthlyPreferences({ ...base, ...overrides })).toEqual({
      changes: [],
      unchangedCount: 0,
      skipped: [{ nurseId: "n", date, reason }],
    });
  });
  it("accepts the inclusive last membership day", () => {
    expect(
      planMonthlyPreferences({
        ...base,
        members: [{ ...base.members[0]!, endedOn: date }],
      }).changes,
    ).toHaveLength(1);
  });
  it("rejects duplicate cell input instead of creating competing decisions", () => {
    expect(() =>
      planMonthlyPreferences({
        ...base,
        preferences: [...base.preferences, ...base.preferences],
      }),
    ).toThrow("same nurse and day");
  });
});
