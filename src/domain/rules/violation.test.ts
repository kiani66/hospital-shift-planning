import { describe, expect, it } from "vitest";

import { isoDate } from "../shared/dates";
import {
  involvesCell,
  violationFootprint,
  violationKey,
  violationMagnitude,
  type Violation,
} from "./violation";

const nightRest = (shift: "M" | "E"): Violation => ({
  rule: "NIGHT_REST",
  severity: "error",
  nurseId: "sara",
  nightDate: isoDate("2026-10-25"),
  date: isoDate("2026-10-26"),
  shift,
});

const staffing = (
  covered: number,
  status: "BELOW_MINIMUM" | "ABOVE_MAXIMUM",
): Violation => ({
  rule: "STAFFING",
  severity: "warning",
  date: isoDate("2026-10-26"),
  period: "M",
  covered,
  status,
  bounds: { min: 3, max: 5 },
});

const duplicate: Violation = {
  rule: "DUPLICATE_ASSIGNMENT",
  severity: "error",
  nurseId: "ali",
  date: isoDate("2026-10-26"),
};

describe("violation attribution", () => {
  it("gives every rule a footprint of nurse and days", () => {
    expect(violationFootprint(nightRest("M"))).toEqual({
      nurseId: "sara",
      dates: ["2026-10-25", "2026-10-26"],
    });
    expect(violationFootprint(duplicate)).toEqual({
      nurseId: "ali",
      dates: ["2026-10-26"],
    });
    expect(
      violationFootprint({ ...duplicate, rule: "OUTSIDE_PERIOD" }),
    ).toEqual({ nurseId: "ali", dates: ["2026-10-26"] });
    expect(violationFootprint(staffing(2, "BELOW_MINIMUM"))).toEqual({
      nurseId: null,
      dates: ["2026-10-26"],
    });
  });

  it("involves the cells of its nurse and days; staffing involves everyone that day", () => {
    const cell = (nurseId: string, date: string) => ({
      nurseId,
      date: isoDate(date),
    });
    expect(involvesCell(nightRest("M"), cell("sara", "2026-10-25"))).toBe(true);
    expect(involvesCell(nightRest("M"), cell("sara", "2026-10-26"))).toBe(true);
    expect(involvesCell(nightRest("M"), cell("sara", "2026-10-27"))).toBe(
      false,
    );
    expect(involvesCell(nightRest("M"), cell("ali", "2026-10-26"))).toBe(false);
    expect(
      involvesCell(staffing(2, "BELOW_MINIMUM"), cell("anyone", "2026-10-26")),
    ).toBe(true);
  });

  it("keys a finding by identity, not by its detail", () => {
    expect(violationKey(nightRest("M"))).toBe(violationKey(nightRest("E")));
    expect(violationKey(staffing(2, "BELOW_MINIMUM"))).toBe(
      violationKey(staffing(1, "BELOW_MINIMUM")),
    );
    expect(violationKey(staffing(2, "BELOW_MINIMUM"))).not.toBe(
      violationKey(staffing(6, "ABOVE_MAXIMUM")),
    );
    expect(violationKey(duplicate)).not.toBe(
      violationKey({ ...duplicate, rule: "OUTSIDE_PERIOD" }),
    );
  });

  it("measures how far a finding is from compliant", () => {
    expect(violationMagnitude(nightRest("M"))).toBe(1);
    expect(violationMagnitude(staffing(1, "BELOW_MINIMUM"))).toBe(2);
    expect(violationMagnitude(staffing(7, "ABOVE_MAXIMUM"))).toBe(2);
  });
});
