import { describe, expect, it } from "vitest";

import { SHIFT_CODES } from "@/domain/shifts/shift-type";

import {
  COVERAGE_PERIOD_NAMES,
  SHIFT_PRESENTATION,
  faClock,
  shiftHoursLabel,
} from "./catalog";

describe("shift catalog", () => {
  it("has a name and a shift-* token for every code", () => {
    for (const code of SHIFT_CODES) {
      const shift = SHIFT_PRESENTATION[code];
      expect(shift.code).toBe(code);
      expect(shift.name).toMatch(/^[؀-ۿ]/);
      expect(shift.tokenClass).toBe(
        `bg-shift-${code.toLowerCase()} text-shift-${code.toLowerCase()}-foreground`,
      );
    }
    expect(SHIFT_PRESENTATION.ME.fullName).toContain("صبح + عصر");
    expect(Object.keys(COVERAGE_PERIOD_NAMES)).toEqual(["M", "E", "N"]);
  });

  it("formats hours from the domain catalog in Persian digits", () => {
    expect(faClock("07:30")).toBe("۰۷:۳۰");
    expect(shiftHoursLabel("M")).toBe("۰۷:۰۰ تا ۱۴:۰۰");
    expect(shiftHoursLabel("E")).toBe("۱۴:۰۰ تا ۱۹:۰۰");
    expect(shiftHoursLabel("ME")).toBe("۰۷:۰۰ تا ۱۹:۰۰");
    expect(shiftHoursLabel("N")).toBe("۱۹:۰۰ تا ۰۷:۰۰ روز بعد");
  });
});
