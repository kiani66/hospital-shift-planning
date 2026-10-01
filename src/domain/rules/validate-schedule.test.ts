import { describe, expect, it } from "vitest";

import { isoDate } from "../shared/dates";
import type { Assignment } from "../shifts/assignment";
import type { ShiftCode } from "../shifts/shift-type";
import { validateSchedule } from "./validate-schedule";
import { hasBlockingViolations, isBlocking, type Violation } from "./violation";

const a = (nurseId: string, date: string, shift: ShiftCode): Assignment => ({
  nurseId,
  date: isoDate(date),
  shift,
});

// Farvardin 1405
const period = { start: isoDate("2026-03-21"), end: isoDate("2026-04-20") };

const summary = (vs: Violation[]) =>
  vs.map((v) => `${v.rule}:${"nurseId" in v ? v.nurseId : "-"}:${v.date}`);

describe("validateSchedule", () => {
  it("returns nothing for a valid schedule", () => {
    const assignments = [
      a("sara", "2026-03-21", "N"),
      a("sara", "2026-03-23", "M"),
      a("ali", "2026-03-21", "ME"),
      a("ali", "2026-03-22", "N"),
    ];
    expect(validateSchedule({ period, assignments })).toEqual([]);
  });

  it("reports night-rest violations inside the period", () => {
    const result = validateSchedule({
      period,
      assignments: [
        a("sara", "2026-03-25", "N"),
        a("sara", "2026-03-26", "ME"),
      ],
    });
    expect(summary(result)).toEqual(["NIGHT_REST:sara:2026-03-26"]);
  });

  describe("across period boundaries", () => {
    it.each<[string, Assignment[], Assignment[], string[]]>([
      [
        "previous period's last-day Night blocks this period's first day",
        [a("sara", "2026-03-21", "M")],
        [a("sara", "2026-03-20", "N")],
        ["NIGHT_REST:sara:2026-03-21"],
      ],
      [
        "this period's last-day Night conflicts with next period's first day",
        [a("sara", "2026-04-20", "N")],
        [a("sara", "2026-04-21", "E")],
        ["NIGHT_REST:sara:2026-04-21"],
      ],
      [
        "previous-period Night followed by OFF is fine",
        [a("sara", "2026-03-22", "M")],
        [a("sara", "2026-03-20", "N")],
        [],
      ],
      [
        "context outside the neighbouring days is ignored",
        [a("sara", "2026-03-21", "M")],
        [a("sara", "2026-03-18", "N"), a("sara", "2026-03-19", "M")],
        [],
      ],
      [
        "violations entirely inside the neighbouring period are not this schedule's",
        [],
        [a("sara", "2026-04-21", "N"), a("sara", "2026-04-22", "M")],
        [],
      ],
    ])("%s", (_, assignments, adjacentAssignments, expected) => {
      expect(
        summary(validateSchedule({ period, assignments, adjacentAssignments })),
      ).toEqual(expected);
    });
  });

  it("D15: ME is the single assignment for a long day", () => {
    expect(
      validateSchedule({
        period,
        assignments: [a("sara", "2026-03-24", "ME")],
      }),
    ).toEqual([]);
  });

  it("D15: M and E on the same day are two assignments (use ME instead)", () => {
    const result = validateSchedule({
      period,
      assignments: [a("sara", "2026-03-24", "M"), a("sara", "2026-03-24", "E")],
    });
    expect(summary(result)).toEqual(["DUPLICATE_ASSIGNMENT:sara:2026-03-24"]);
  });

  it("flags working-copy assignments outside the period", () => {
    const result = validateSchedule({
      period,
      assignments: [a("sara", "2026-03-20", "M"), a("ali", "2026-04-21", "E")],
    });
    expect(summary(result)).toEqual([
      "OUTSIDE_PERIOD:sara:2026-03-20",
      "OUTSIDE_PERIOD:ali:2026-04-21",
    ]);
  });

  it("does not add night-rest pairs that lie wholly outside the period", () => {
    const result = validateSchedule({
      period,
      assignments: [a("sara", "2026-05-01", "N"), a("sara", "2026-05-02", "M")],
    });
    expect(summary(result)).toEqual([
      "OUTSIDE_PERIOD:sara:2026-05-01",
      "OUTSIDE_PERIOD:sara:2026-05-02",
    ]);
  });

  it("sorts by date, then nurse, then rule", () => {
    const result = validateSchedule({
      period,
      assignments: [
        a("zahra", "2026-03-22", "N"),
        a("zahra", "2026-03-23", "M"),
        a("ali", "2026-03-23", "N"),
        a("ali", "2026-03-23", "M"),
        a("ali", "2026-03-22", "N"),
      ],
    });
    expect(summary(result)).toEqual([
      "DUPLICATE_ASSIGNMENT:ali:2026-03-23",
      "NIGHT_REST:ali:2026-03-23",
      "NIGHT_REST:ali:2026-03-23",
      "NIGHT_REST:zahra:2026-03-23",
    ]);
  });

  it("every current rule is blocking", () => {
    const result = validateSchedule({
      period,
      assignments: [
        a("sara", "2026-03-21", "N"),
        a("sara", "2026-03-22", "N"),
        a("sara", "2026-05-01", "M"),
      ],
    });
    expect(result.length).toBeGreaterThan(0);
    expect(result.every(isBlocking)).toBe(true);
    expect(hasBlockingViolations(result)).toBe(true);
  });
});

describe("hasBlockingViolations", () => {
  it("is false for no violations", () => {
    expect(hasBlockingViolations([])).toBe(false);
  });

  it("ignores warnings", () => {
    const warning = { severity: "warning" } as unknown as Violation;
    expect(isBlocking(warning)).toBe(false);
    expect(hasBlockingViolations([warning])).toBe(false);
  });
});

describe("staffing (warnings)", () => {
  it("adds staffing warnings next to hard findings without making them blocking", () => {
    const result = validateSchedule({
      period,
      assignments: [a("sara", "2026-03-25", "N"), a("sara", "2026-03-26", "M")],
      staffingRequirements: new Map([
        [isoDate("2026-03-26"), { M: { min: 2 }, E: { min: 1 } }],
      ]),
    });
    // Day-level findings sort before the nurses' findings of the same day.
    expect(result.map((v) => v.rule)).toEqual([
      "STAFFING",
      "STAFFING",
      "NIGHT_REST",
    ]);
    const staffing = result.filter((v) => v.rule === "STAFFING");
    expect(staffing.map((v) => v.period)).toEqual(["E", "M"]);
    expect(hasBlockingViolations(staffing)).toBe(false);
    expect(hasBlockingViolations(result)).toBe(true);
  });

  it("checks no staffing when no requirements are given", () => {
    expect(
      validateSchedule({
        period,
        assignments: [a("sara", "2026-03-26", "M")],
      }),
    ).toEqual([]);
  });
});
