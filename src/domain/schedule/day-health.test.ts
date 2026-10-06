import { describe, expect, it } from "vitest";

import { validateSchedule } from "../rules/validate-schedule";
import { isoDate } from "../shared/dates";
import type { Assignment } from "../shifts/assignment";
import type { AssignmentCode } from "../shifts/shift-type";
import { summarizeScheduleDays } from "./day-health";

const a = (
  nurseId: string,
  date: string,
  shift: AssignmentCode,
): Assignment => ({ nurseId, date: isoDate(date), shift });

// A short period keeps the expectations readable.
const period = { start: isoDate("2026-10-23"), end: isoDate("2026-10-26") };

const summarize = (assignments: Assignment[], rosterNurseIds?: string[]) =>
  summarizeScheduleDays({
    period,
    assignments,
    violations: validateSchedule({ period, assignments, rosterNurseIds }),
  });

describe("summarizeScheduleDays (D103)", () => {
  it("has one entry per day; a day without decisions is NOT_STARTED", () => {
    const { days, validation } = summarize([], ["sara"]);
    expect(days.map((d) => [d.date, d.state])).toEqual([
      ["2026-10-23", "NOT_STARTED"],
      ["2026-10-24", "NOT_STARTED"],
      ["2026-10-25", "NOT_STARTED"],
      ["2026-10-26", "NOT_STARTED"],
    ]);
    expect(validation).toMatchObject({ undecided: 4, ready: false });
  });

  it("counts assignment types and operational coverage separately (OFF is neither)", () => {
    const { days } = summarize([
      a("sara", "2026-10-23", "M"),
      a("ali", "2026-10-23", "ME"),
      a("zahra", "2026-10-23", "E"),
      a("negar", "2026-10-23", "N"),
      a("maryam", "2026-10-23", "OFF"),
    ]);
    expect(days[0]).toMatchObject({
      state: "READY",
      decisions: 5,
      shifts: { M: 1, E: 1, N: 1, ME: 1 },
      coverage: { M: 2, E: 2, N: 1 },
    });
  });

  it("puts a night-rest violation on the day after the Night", () => {
    const { days } = summarize([
      a("sara", "2026-10-24", "N"),
      a("sara", "2026-10-25", "M"),
    ]);
    expect(days.map((d) => d.state)).toEqual([
      "READY",
      "READY",
      "RULE_VIOLATION",
      "READY",
    ]);
    expect(days[2]).toMatchObject({ ruleViolations: 1, ready: false });
  });

  it("ignores assignments outside the period and counts their findings for the month", () => {
    const { days, validation } = summarize([a("ali", "2026-11-30", "M")]);
    expect(days.every((d) => d.decisions === 0)).toBe(true);
    expect(validation.unattributedRuleViolations).toBe(1);
  });
});
