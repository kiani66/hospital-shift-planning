import { describe, expect, it } from "vitest";

import { isoDate } from "../shared/dates";
import type { Assignment } from "../shifts/assignment";
import type { ShiftCode } from "../shifts/shift-type";
import {
  findStaffingViolations,
  staffingStatus,
  type StaffingRequirement,
} from "./staffing";
import { isBlocking } from "./violation";

// Bounds here are test fixtures only; no real staffing numbers are defined yet.
describe("staffingStatus", () => {
  it.each([
    [3, undefined, "NOT_CONFIGURED"],
    [3, {}, "NOT_CONFIGURED"],
    [2, { min: 3 }, "BELOW_MINIMUM"],
    [3, { min: 3 }, "WITHIN_BOUNDS"],
    [9, { min: 3 }, "WITHIN_BOUNDS"],
    [5, { max: 4 }, "ABOVE_MAXIMUM"],
    [0, { max: 4 }, "WITHIN_BOUNDS"],
    [2, { min: 3, max: 5 }, "BELOW_MINIMUM"],
    [4, { min: 3, max: 5 }, "WITHIN_BOUNDS"],
    [6, { min: 3, max: 5 }, "ABOVE_MAXIMUM"],
  ] as const)("%i nurses with %j is %s", (covered, bounds, expected) => {
    expect(staffingStatus(covered, bounds)).toBe(expected);
  });
});

const a = (nurseId: string, date: string, shift: ShiftCode): Assignment => ({
  nurseId,
  date: isoDate(date),
  shift,
});
const period = { start: isoDate("2026-10-23"), end: isoDate("2026-11-21") };
const requirements = (
  entries: [string, StaffingRequirement][],
): ReadonlyMap<ReturnType<typeof isoDate>, StaffingRequirement> =>
  new Map(entries.map(([d, r]) => [isoDate(d), r]));

describe("findStaffingViolations", () => {
  it("reports nothing when no requirement is configured (the production default)", () => {
    expect(
      findStaffingViolations({
        period,
        assignments: [a("sara", "2026-10-25", "M")],
        requirements: new Map(),
      }),
    ).toEqual([]);
  });

  it("counts operational coverage per period: ME counts toward M and E", () => {
    const result = findStaffingViolations({
      period,
      assignments: [
        a("sara", "2026-10-25", "ME"),
        a("ali", "2026-10-25", "M"),
        a("reza", "2026-10-26", "M"),
      ],
      requirements: requirements([
        ["2026-10-25", { M: { min: 2, max: 2 }, E: { min: 2 }, N: { max: 0 } }],
      ]),
    });
    expect(result).toEqual([
      {
        rule: "STAFFING",
        severity: "warning",
        date: "2026-10-25",
        period: "E",
        covered: 1,
        status: "BELOW_MINIMUM",
        bounds: { min: 2 },
      },
    ]);
    expect(result.every(isBlocking)).toBe(false);
  });

  it("reports a period above its maximum", () => {
    expect(
      findStaffingViolations({
        period,
        assignments: [
          a("sara", "2026-10-25", "N"),
          a("ali", "2026-10-25", "N"),
        ],
        requirements: requirements([["2026-10-25", { N: { max: 1 } }]]),
      }),
    ).toMatchObject([{ period: "N", covered: 2, status: "ABOVE_MAXIMUM" }]);
  });

  it("ignores requirements of days outside the period", () => {
    expect(
      findStaffingViolations({
        period,
        assignments: [],
        requirements: requirements([["2026-12-01", { M: { min: 1 } }]]),
      }),
    ).toEqual([]);
  });
});
