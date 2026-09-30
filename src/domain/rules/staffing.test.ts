import { describe, expect, it } from "vitest";

import { staffingStatus } from "./staffing";

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
