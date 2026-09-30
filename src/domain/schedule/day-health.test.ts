import { describe, expect, it } from "vitest";

import type { Diagnostic } from "../rules/diagnostic";
import { toDiagnostic } from "../rules/diagnostic";
import { validateSchedule } from "../rules/validate-schedule";
import { isoDate } from "../shared/dates";
import type { Assignment } from "../shifts/assignment";
import type { ShiftCode } from "../shifts/shift-type";
import { dayHealth, summarizeScheduleDays } from "./day-health";

const a = (nurseId: string, date: string, shift: ShiftCode): Assignment => ({
  nurseId,
  date: isoDate(date),
  shift,
});

// A short period keeps the expectations readable.
const period = { start: isoDate("2026-10-23"), end: isoDate("2026-10-26") };

function summarize(assignments: Assignment[], extra: Diagnostic[] = []) {
  const diagnostics = [
    ...validateSchedule({ period, assignments }).map((v) =>
      toDiagnostic(v, period),
    ),
    ...extra,
  ];
  return summarizeScheduleDays({ period, assignments, diagnostics });
}

describe("dayHealth", () => {
  it.each([
    [0, 0, "UNPLANNED"],
    [0, 2, "UNPLANNED"],
    [3, 0, "VALID"],
    [3, 1, "NEEDS_ATTENTION"],
  ] as const)(
    "%i assignments and %i findings is %s",
    (assignmentCount, findingCount, expected) => {
      expect(dayHealth({ assignmentCount, findingCount })).toBe(expected);
    },
  );
});

describe("summarizeScheduleDays", () => {
  it("has one entry per day of the period, unplanned when nothing is assigned", () => {
    const { days, unattributedFindings } = summarize([]);
    expect(days.map((d) => [d.date, d.health])).toEqual([
      ["2026-10-23", "UNPLANNED"],
      ["2026-10-24", "UNPLANNED"],
      ["2026-10-25", "UNPLANNED"],
      ["2026-10-26", "UNPLANNED"],
    ]);
    expect(unattributedFindings).toBe(0);
  });

  it("counts assignment types and operational coverage separately", () => {
    const { days } = summarize([
      a("sara", "2026-10-23", "M"),
      a("ali", "2026-10-23", "ME"),
      a("zahra", "2026-10-23", "E"),
      a("negar", "2026-10-23", "N"),
    ]);
    expect(days[0]).toMatchObject({
      health: "VALID",
      shifts: { M: 1, E: 1, N: 1, ME: 1 },
      coverage: { M: 2, E: 2, N: 1 },
      findings: { blocking: 0, other: 0 },
    });
  });

  it("marks the day of the offending assignment as needing attention", () => {
    const { days } = summarize([
      a("sara", "2026-10-24", "N"),
      a("sara", "2026-10-25", "M"),
    ]);
    expect(days.map((d) => d.health)).toEqual([
      "UNPLANNED",
      "VALID",
      "NEEDS_ATTENTION",
      "UNPLANNED",
    ]);
    expect(days[2]!.findings).toEqual({ blocking: 1, other: 0 });
  });

  it("counts non-blocking findings apart from blocking ones", () => {
    const warning: Diagnostic = {
      ...toDiagnostic(
        {
          rule: "DUPLICATE_ASSIGNMENT",
          severity: "error",
          nurseId: "ali",
          date: isoDate("2026-10-23"),
        },
        period,
      ),
      severity: "warning",
      blocking: false,
    };
    const { days } = summarize([a("ali", "2026-10-23", "M")], [warning]);
    expect(days[0]).toMatchObject({
      health: "NEEDS_ATTENTION",
      findings: { blocking: 0, other: 1 },
    });
  });

  it("ignores assignments outside the period and counts their findings apart", () => {
    const { days, unattributedFindings } = summarize([
      a("ali", "2026-11-30", "M"),
    ]);
    expect(days.every((d) => d.health === "UNPLANNED")).toBe(true);
    expect(unattributedFindings).toBe(1);
  });
});
