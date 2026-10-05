import { describe, expect, it } from "vitest";

import { PREFERENCE_VALUES, SHIFT_CODES } from "@/domain/shifts/shift-type";

import {
  COVERAGE_PERIOD_NAMES,
  SHIFT_DISPLAY,
  SHIFT_PRESENTATION,
  preferencePresentation,
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
      expect(shift.accentClass).toBe(
        `text-shift-${code.toLowerCase()}-foreground`,
      );
      expect(shift.dotClass).toBe(`bg-shift-${code.toLowerCase()}-foreground`);
      expect(shift.softClass).toBe(`bg-shift-${code.toLowerCase()}/45`);
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

describe("shared shift display (code, name, icon, color)", () => {
  it("covers every preference value, OFF included, each with its own icon", () => {
    for (const value of PREFERENCE_VALUES) {
      const shift = preferencePresentation(value);
      expect(shift.code).toBe(value);
      expect(shift.name).toMatch(/^[؀-ۿ]/);
      expect(shift.tokenClass).toBe(
        `bg-shift-${value.toLowerCase()} text-shift-${value.toLowerCase()}-foreground`,
      );
      expect(shift.icon).toBeDefined();
    }
    const icons = new Set(PREFERENCE_VALUES.map((v) => SHIFT_DISPLAY[v].icon));
    expect(icons.size).toBe(PREFERENCE_VALUES.length);
  });

  it("reuses the shift entries and keeps the short Persian names", () => {
    for (const code of SHIFT_CODES)
      expect(SHIFT_DISPLAY[code]).toBe(SHIFT_PRESENTATION[code]);
    expect(
      Object.fromEntries(
        PREFERENCE_VALUES.map((v) => [v, SHIFT_DISPLAY[v].name]),
      ),
    ).toEqual({ M: "صبح", E: "عصر", N: "شب", ME: "طولانی", OFF: "استراحت" });
  });
});
