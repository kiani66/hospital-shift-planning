import { describe, expect, it } from "vitest";

import {
  ASSIGNMENT_CODES,
  PREFERENCE_VALUES,
  SHIFT_CODES,
} from "@/domain/shifts/shift-type";

import {
  RENAMED_SHIFT_LABELS,
  SHIFT_LABELS,
} from "../../../tests/support/shift-labels";

import {
  ASSIGNMENT_PRESENTATION,
  OFF_PRESENTATION,
  SHIFT_PRESENTATION,
  assignmentName,
  faClock,
  shiftFullName,
  shiftHoursLabel,
} from "./catalog";

describe("shift catalog", () => {
  it("has a shift-* token for every code", () => {
    for (const code of SHIFT_CODES) {
      const shift = SHIFT_PRESENTATION[code];
      expect(shift.code).toBe(code);
      expect(shift.tokenClass).toBe(
        `bg-shift-${code.toLowerCase()} text-shift-${code.toLowerCase()}-foreground`,
      );
      expect(shift.accentClass).toBe(
        `text-shift-${code.toLowerCase()}-foreground`,
      );
      expect(shift.dotClass).toBe(`bg-shift-${code.toLowerCase()}-foreground`);
      expect(shift.softClass).toBe(`bg-shift-${code.toLowerCase()}/45`);
    }
  });

  it("holds no names: descriptive names are the shift_types labels", () => {
    for (const code of ASSIGNMENT_CODES)
      expect(Object.keys(ASSIGNMENT_PRESENTATION[code]).sort()).toEqual([
        "accentClass",
        "code",
        "dotClass",
        "icon",
        "softClass",
        "tokenClass",
      ]);
  });

  it("formats hours from the domain catalog in Persian digits", () => {
    expect(faClock("07:30")).toBe("۰۷:۳۰");
    expect(shiftHoursLabel("M", SHIFT_LABELS)).toBe("۰۷:۰۰ تا ۱۴:۰۰");
    expect(shiftHoursLabel("E", SHIFT_LABELS)).toBe("۱۴:۰۰ تا ۱۹:۰۰");
    expect(shiftHoursLabel("ME", SHIFT_LABELS)).toBe("۰۷:۰۰ تا ۱۹:۰۰");
    expect(shiftHoursLabel("N", SHIFT_LABELS)).toBe("۱۹:۰۰ تا ۰۷:۰۰ روز بعد");
  });

  it("spells out a multi-period shift from the labels of the periods it covers", () => {
    expect(shiftFullName("ME", SHIFT_LABELS)).toBe("طولانی (صبح + عصر)");
    expect(shiftFullName("M", SHIFT_LABELS)).toBe("صبح");
    expect(shiftFullName("OFF", SHIFT_LABELS)).toBe("استراحت");
    expect(shiftFullName("ME", RENAMED_SHIFT_LABELS)).toBe(
      "لانگ (بامداد + پسین)",
    );
  });
});

describe("assignment presentation (code, icon, color)", () => {
  it("covers every explicit decision, OFF included, each with its own icon", () => {
    for (const code of ASSIGNMENT_CODES) {
      const shift = ASSIGNMENT_PRESENTATION[code];
      expect(shift.code).toBe(code);
      expect(shift.icon).toBeDefined();
    }
    const icons = new Set(
      ASSIGNMENT_CODES.map((c) => ASSIGNMENT_PRESENTATION[c].icon),
    );
    expect(icons.size).toBe(ASSIGNMENT_CODES.length);
    // Preferences are the same codes (wishes, not decisions).
    expect([...PREFERENCE_VALUES]).toEqual([...ASSIGNMENT_CODES]);
  });

  it("reuses the working-shift entries", () => {
    for (const code of SHIFT_CODES)
      expect(ASSIGNMENT_PRESENTATION[code]).toBe(SHIFT_PRESENTATION[code]);
  });

  it("shows OFF as neutral rest, not a working shift, and a missing row as undecided", () => {
    expect(ASSIGNMENT_PRESENTATION.OFF).toBe(OFF_PRESENTATION);
    expect(OFF_PRESENTATION.tokenClass).toBe("bg-muted text-muted-foreground");
    expect(OFF_PRESENTATION.tokenClass).not.toMatch(/shift-/);
    expect(shiftHoursLabel("OFF", SHIFT_LABELS)).toBe("استراحت");
  });

  it("names every decision as «label (CODE)», OFF included, from the labels given", () => {
    expect(
      ASSIGNMENT_CODES.map((c) => assignmentName(c, SHIFT_LABELS)),
    ).toEqual(["صبح (M)", "عصر (E)", "شب (N)", "طولانی (ME)", "استراحت (OFF)"]);
    expect(assignmentName(null, SHIFT_LABELS)).toBe("تعیین‌نشده");
    // A different label changes the name, never the code.
    expect(assignmentName("OFF", RENAMED_SHIFT_LABELS)).toBe("مرخصی‌روز (OFF)");
    expect(assignmentName("N", RENAMED_SHIFT_LABELS)).toBe("شبانه (N)");
  });
});
