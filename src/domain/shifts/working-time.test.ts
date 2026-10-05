import { describe, expect, it } from "vitest";

import { SHIFT_TYPES, shiftDurationMinutes } from "./shift-type";
import { summarizeShifts } from "./working-time";

describe("summarizeShifts", () => {
  it("is all zeros without assignments", () => {
    expect(summarizeShifts([])).toEqual({
      shiftCount: 0,
      offCount: 0,
      minutes: 0,
      nightCount: 0,
      byCode: { M: 0, E: 0, N: 0, ME: 0 },
    });
  });

  it("adds the catalog duration of every shift and counts nights", () => {
    // M 7h, E 5h, N 12h (crosses midnight), ME 12h.
    expect(summarizeShifts(["M", "E", "N", "ME", "N"])).toEqual({
      shiftCount: 5,
      offCount: 0,
      minutes: (7 + 5 + 12 + 12 + 12) * 60,
      nightCount: 2,
      byCode: { M: 1, E: 1, N: 2, ME: 1 },
    });
  });

  it("takes hours from the catalog, never a second table", () => {
    const codes = ["M", "M", "ME"] as const;
    expect(summarizeShifts(codes).minutes).toBe(
      codes.reduce((sum, c) => sum + shiftDurationMinutes(SHIFT_TYPES[c]), 0),
    );
  });

  it("accepts any iterable", () => {
    function* nights() {
      yield "N" as const;
      yield "N" as const;
    }
    expect(summarizeShifts(nights()).nightCount).toBe(2);
  });
});
