import { describe, expect, it } from "vitest";

import { isoDate } from "../shared/dates";
import type { Assignment } from "../shifts/assignment";
import type { ShiftCode } from "../shifts/shift-type";
import { findNightRestViolations } from "./night-rest";

const a = (nurseId: string, date: string, shift: ShiftCode): Assignment => ({
  nurseId,
  date: isoDate(date),
  shift,
});

describe("findNightRestViolations (N on D requires OFF on D+1)", () => {
  it.each(["M", "E", "ME", "N"] as const)("N → %s is invalid", (next) => {
    expect(
      findNightRestViolations([
        a("sara", "2026-03-21", "N"),
        a("sara", "2026-03-22", next),
      ]),
    ).toEqual([
      {
        rule: "NIGHT_REST",
        severity: "error",
        nurseId: "sara",
        nightDate: "2026-03-21",
        date: "2026-03-22",
        shift: next,
      },
    ]);
  });

  it.each([
    ["N then off", [a("sara", "2026-03-21", "N")]],
    ["N, off, N", [a("sara", "2026-03-21", "N"), a("sara", "2026-03-23", "N")]],
    ["M then N", [a("sara", "2026-03-21", "M"), a("sara", "2026-03-22", "N")]],
    [
      "ME then N",
      [a("sara", "2026-03-21", "ME"), a("sara", "2026-03-22", "N")],
    ],
    ["E then M", [a("sara", "2026-03-21", "E"), a("sara", "2026-03-22", "M")]],
    [
      "N then another nurse works",
      [a("sara", "2026-03-21", "N"), a("ali", "2026-03-22", "M")],
    ],
    [
      "shift the day before N",
      [a("sara", "2026-03-20", "M"), a("sara", "2026-03-21", "N")],
    ],
    ["nothing", []],
  ])("%s is valid", (_, assignments) => {
    expect(findNightRestViolations(assignments)).toEqual([]);
  });

  it("applies across month and year boundaries", () => {
    const violations = findNightRestViolations([
      a("sara", "2026-04-20", "N"), // last day of Farvardin
      a("sara", "2026-04-21", "M"), // first day of Ordibehesht
      a("ali", "2026-12-31", "N"),
      a("ali", "2027-01-01", "E"),
    ]);
    expect(violations.map((v) => [v.nurseId, v.nightDate, v.date])).toEqual([
      ["sara", "2026-04-20", "2026-04-21"],
      ["ali", "2026-12-31", "2027-01-01"],
    ]);
  });

  it("reports consecutive nights once per offending pair, sorted by date then nurse", () => {
    const violations = findNightRestViolations([
      a("sara", "2026-03-23", "N"),
      a("sara", "2026-03-22", "N"),
      a("sara", "2026-03-21", "N"),
      a("ali", "2026-03-21", "N"),
      a("ali", "2026-03-22", "M"),
    ]);
    expect(violations.map((v) => `${v.date}:${v.nurseId}`)).toEqual([
      "2026-03-22:ali",
      "2026-03-22:sara",
      "2026-03-23:sara",
    ]);
  });

  it("reports each duplicate next-day assignment", () => {
    const violations = findNightRestViolations([
      a("sara", "2026-03-21", "N"),
      a("sara", "2026-03-22", "M"),
      a("sara", "2026-03-22", "E"),
    ]);
    expect(violations.map((v) => v.shift)).toEqual(["M", "E"]);
  });
});
