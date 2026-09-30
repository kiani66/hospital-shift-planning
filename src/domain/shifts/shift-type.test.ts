import { describe, expect, it } from "vitest";

import {
  clockMinutes,
  COVERAGE_PERIODS,
  crossesMidnight,
  isNightShift,
  isPreferenceValue,
  isShiftCode,
  PREFERENCE_VALUES,
  SHIFT_CODES,
  SHIFT_TYPES,
  shiftDurationMinutes,
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
    expect(SHIFT_TYPES[code]).toMatchObject({ code, covers, isNight: night });
    expect(isNightShift(code)).toBe(night);
  });

  it.each([
    ["M", "07:00", "14:00", false, 7 * 60],
    ["E", "14:00", "19:00", false, 5 * 60],
    ["N", "19:00", "07:00", true, 12 * 60],
    ["ME", "07:00", "19:00", false, 12 * 60],
  ] as const)(
    "%s runs %s–%s (crosses midnight: %s, %i minutes)",
    (code, start, end, overnight, minutes) => {
      const shift = SHIFT_TYPES[code];
      expect(shift).toMatchObject({ start, end });
      expect(crossesMidnight(shift)).toBe(overnight);
      expect(shiftDurationMinutes(shift)).toBe(minutes);
    },
  );

  it("covers exactly the coverage periods its hours span", () => {
    // Coverage is declared (`covers`), not inferred from hours; keep both in step.
    const span = (s: { start: string; end: string }) => {
      const from = clockMinutes(s.start);
      const length =
        (clockMinutes(s.end) - from + 24 * 60) % (24 * 60) || 24 * 60;
      return Array.from({ length }, (_, i) => (from + i) % (24 * 60));
    };
    for (const shift of Object.values(SHIFT_TYPES)) {
      const covered = shift.covers.flatMap((p) => span(SHIFT_TYPES[p]));
      expect(covered.sort((a, b) => a - b)).toEqual(
        span(shift).sort((a, b) => a - b),
      );
    }
  });

  it("orders coverage periods M, E, N; together they span the whole day", () => {
    expect(COVERAGE_PERIODS).toEqual(["M", "E", "N"]);
    expect(
      COVERAGE_PERIODS.reduce(
        (sum, p) => sum + shiftDurationMinutes(SHIFT_TYPES[p]),
        0,
      ),
    ).toBe(24 * 60);
  });

  it.each(["7:00", "24:00", "07:60", "0700", ""])(
    "rejects the clock time %j",
    (time) => {
      expect(() => clockMinutes(time)).toThrow(RangeError);
    },
  );

  it("reads HH:MM as minutes since midnight", () => {
    expect(clockMinutes("00:00")).toBe(0);
    expect(clockMinutes("23:59")).toBe(23 * 60 + 59);
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
