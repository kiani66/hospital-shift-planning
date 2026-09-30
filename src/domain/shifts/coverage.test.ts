import { describe, expect, it } from "vitest";

import {
  countByShift,
  coverageOf,
  emptyShiftCounts,
  shiftsCovering,
} from "./coverage";

describe("coverage", () => {
  it("counts assignments by type", () => {
    expect(countByShift(["M", "ME", "M", "N"])).toEqual({
      M: 2,
      E: 0,
      N: 1,
      ME: 1,
    });
    expect(countByShift([])).toEqual(emptyShiftCounts());
  });

  it("counts a long shift (ME) toward both Morning and Evening coverage", () => {
    expect(coverageOf({ M: 3, E: 2, N: 4, ME: 2 })).toEqual({
      M: 5,
      E: 4,
      N: 4,
    });
  });

  it("is not the same as counting codes", () => {
    const counts = countByShift(["ME", "ME"]);
    expect(counts.M + counts.E).toBe(0);
    expect(coverageOf(counts)).toEqual({ M: 2, E: 2, N: 0 });
  });

  it.each([
    ["M", ["M", "ME"]],
    ["E", ["E", "ME"]],
    ["N", ["N"]],
  ] as const)("period %s is staffed by %j", (period, codes) => {
    expect(shiftsCovering(period)).toEqual(codes);
  });
});
