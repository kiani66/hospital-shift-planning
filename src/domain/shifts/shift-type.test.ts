import { describe, expect, it } from "vitest";

import {
  isNightShift,
  isPreferenceValue,
  isShiftCode,
  PREFERENCE_VALUES,
  SHIFT_CODES,
  SHIFT_TYPES,
} from "./shift-type";

describe("shift types", () => {
  it("defines exactly M, E, N, ME", () => {
    expect(SHIFT_CODES).toEqual(["M", "E", "N", "ME"]);
    expect(Object.keys(SHIFT_TYPES).sort()).toEqual(["E", "M", "ME", "N"]);
  });

  it.each([
    ["M", ["M"], false],
    ["E", ["E"], false],
    ["N", ["N"], true],
    ["ME", ["M", "E"], false],
  ] as const)("%s covers %j, night=%s", (code, covers, night) => {
    expect(SHIFT_TYPES[code]).toEqual({ code, covers, isNight: night });
    expect(isNightShift(code)).toBe(night);
  });

  it.each([
    ["M", true],
    ["ME", true],
    ["OFF", false],
    ["m", false],
    ["EM", false],
    ["", false],
    [null, false],
    [1, false],
  ])("isShiftCode(%j) = %s", (value, expected) => {
    expect(isShiftCode(value)).toBe(expected);
  });
});

describe("preference values", () => {
  it("are the shift codes plus OFF (one preference per day)", () => {
    expect(PREFERENCE_VALUES).toEqual(["M", "E", "N", "ME", "OFF"]);
  });

  it.each([
    ["OFF", true],
    ["N", true],
    ["LEAVE", false],
    [undefined, false],
  ])("isPreferenceValue(%j) = %s", (value, expected) => {
    expect(isPreferenceValue(value)).toBe(expected);
  });
});
