import { describe, expect, it } from "vitest";

import { isoDate } from "../shared/dates";
import { RULE_SCOPES, toDiagnostic, violationDay } from "./diagnostic";
import type { Violation } from "./violation";

// Aban 1405
const period = { start: isoDate("2026-10-23"), end: isoDate("2026-11-21") };

const nightRest = (nightDate: string, date: string): Violation => ({
  rule: "NIGHT_REST",
  severity: "error",
  nurseId: "sara",
  nightDate: isoDate(nightDate),
  date: isoDate(date),
  shift: "M",
});

describe("violationDay", () => {
  it("is the day of the offending assignment", () => {
    expect(violationDay(nightRest("2026-10-25", "2026-10-26"), period)).toBe(
      "2026-10-26",
    );
  });

  it("is the Night's day when the next day belongs to the following schedule", () => {
    expect(violationDay(nightRest("2026-11-21", "2026-11-22"), period)).toBe(
      "2026-11-21",
    );
  });

  it("is the first day when the Night was in the previous schedule", () => {
    expect(violationDay(nightRest("2026-10-22", "2026-10-23"), period)).toBe(
      "2026-10-23",
    );
  });

  it("is null for an assignment outside the period", () => {
    const outside: Violation = {
      rule: "OUTSIDE_PERIOD",
      severity: "error",
      nurseId: "ali",
      date: isoDate("2026-12-01"),
    };
    expect(violationDay(outside, period)).toBeNull();
    expect(
      violationDay(nightRest("2026-12-01", "2026-12-02"), period),
    ).toBeNull();
  });
});

describe("toDiagnostic", () => {
  it("describes a night-rest violation: nurse scope, blocking, both days, the shift", () => {
    const v = nightRest("2026-10-25", "2026-10-26");
    expect(toDiagnostic(v, period)).toEqual({
      code: "NIGHT_REST",
      scope: "NURSE",
      severity: "error",
      blocking: true,
      date: "2026-10-26",
      dates: ["2026-10-25", "2026-10-26"],
      nurseIds: ["sara"],
      shift: "M",
      violation: v,
    });
  });

  it("describes an assignment-level violation", () => {
    const v: Violation = {
      rule: "DUPLICATE_ASSIGNMENT",
      severity: "error",
      nurseId: "ali",
      date: isoDate("2026-10-30"),
    };
    expect(toDiagnostic(v, period)).toMatchObject({
      code: "DUPLICATE_ASSIGNMENT",
      scope: "ASSIGNMENT",
      blocking: true,
      date: "2026-10-30",
      dates: ["2026-10-30"],
      nurseIds: ["ali"],
      shift: null,
    });
  });

  it("has a scope for every rule", () => {
    expect(Object.keys(RULE_SCOPES).sort()).toEqual([
      "DUPLICATE_ASSIGNMENT",
      "NIGHT_REST",
      "OUTSIDE_PERIOD",
      "STAFFING",
      "UNDECIDED",
    ]);
  });

  it("describes a staffing warning: shift scope, not blocking, no nurse", () => {
    const v: Violation = {
      rule: "STAFFING",
      severity: "warning",
      date: isoDate("2026-10-30"),
      period: "N",
      covered: 1,
      status: "BELOW_MINIMUM",
      bounds: { min: 2 },
    };
    expect(toDiagnostic(v, period)).toMatchObject({
      code: "STAFFING",
      scope: "SHIFT",
      severity: "warning",
      blocking: false,
      date: "2026-10-30",
      dates: ["2026-10-30"],
      nurseIds: [],
      shift: null,
    });
  });
});
