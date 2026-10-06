import { describe, expect, it } from "vitest";

import {
  ASSIGNMENT_CODES,
  PREFERENCE_VALUES,
  SHIFT_CODES,
} from "@/domain/shifts/shift-type";

import {
  ASSIGNMENT_PRESENTATION,
  COVERAGE_PERIOD_NAMES,
  OFF_PRESENTATION,
  SHIFT_PRESENTATION,
  assignmentName,
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

describe("assignment presentation (code, name, icon, color)", () => {
  it("covers every explicit decision, OFF included, each with its own icon", () => {
    for (const code of ASSIGNMENT_CODES) {
      const shift = ASSIGNMENT_PRESENTATION[code];
      expect(shift.code).toBe(code);
      expect(shift.name).toMatch(/^[؀-ۿ]/);
      expect(shift.icon).toBeDefined();
    }
    const icons = new Set(
      ASSIGNMENT_CODES.map((c) => ASSIGNMENT_PRESENTATION[c].icon),
    );
    expect(icons.size).toBe(ASSIGNMENT_CODES.length);
    // Preferences are the same codes (wishes, not decisions).
    expect([...PREFERENCE_VALUES]).toEqual([...ASSIGNMENT_CODES]);
  });

  it("reuses the working-shift entries and keeps the short Persian names", () => {
    for (const code of SHIFT_CODES)
      expect(ASSIGNMENT_PRESENTATION[code]).toBe(SHIFT_PRESENTATION[code]);
    expect(
      Object.fromEntries(
        ASSIGNMENT_CODES.map((c) => [c, ASSIGNMENT_PRESENTATION[c].name]),
      ),
    ).toEqual({ M: "صبح", E: "عصر", N: "شب", ME: "طولانی", OFF: "استراحت" });
  });

  it("shows OFF as neutral rest, not a working shift, and a missing row as undecided", () => {
    expect(ASSIGNMENT_PRESENTATION.OFF).toBe(OFF_PRESENTATION);
    expect(OFF_PRESENTATION.tokenClass).toBe("bg-muted text-muted-foreground");
    expect(OFF_PRESENTATION.tokenClass).not.toMatch(/shift-/);
    expect(shiftHoursLabel("OFF")).toBe("استراحت");
    expect(assignmentName("OFF")).toBe("استراحت");
    expect(assignmentName(null)).toBe("تعیین‌نشده");
    expect(assignmentName("N")).toBe("شب (N)");
  });
});
