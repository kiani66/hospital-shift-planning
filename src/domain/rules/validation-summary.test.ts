import { describe, expect, it } from "vitest";

import { isoDate } from "../shared/dates";
import type { Assignment } from "../shifts/assignment";
import type { AssignmentCode } from "../shifts/shift-type";
import type { StaffingRequirement } from "./staffing";
import { validateSchedule } from "./validate-schedule";
import {
  compareValidation,
  coverageProblems,
  DAY_STATES,
  summarizeValidation,
  validationCategory,
  validationCounts,
} from "./validation-summary";
import type { Violation } from "./violation";

const d = isoDate;
const period = { start: d("2026-11-01"), end: d("2026-11-03") };
const a = (
  nurseId: string,
  date: string,
  shift: AssignmentCode,
): Assignment => ({
  nurseId,
  date: d(date),
  shift,
});
const pilot = { min: 3, max: 6 };
const everyDay = (requirement: StaffingRequirement) =>
  new Map(
    ["2026-11-01", "2026-11-02", "2026-11-03"].map((x) => [d(x), requirement]),
  );

function summarize(
  assignments: Assignment[],
  options: {
    roster?: string[];
    requirement?: StaffingRequirement;
    extra?: Violation[];
  } = {},
) {
  const violations = [
    ...validateSchedule({
      period,
      assignments,
      rosterNurseIds: options.roster,
      staffingRequirements: options.requirement
        ? everyDay(options.requirement)
        : undefined,
    }),
    ...(options.extra ?? []),
  ];
  return summarizeValidation({ period, assignments, violations });
}

describe("validationCategory (D102)", () => {
  it.each([
    [{ rule: "UNDECIDED" }, "UNDECIDED"],
    [{ rule: "STAFFING" }, "COVERAGE"],
    [{ rule: "NIGHT_REST" }, "RULE_VIOLATION"],
    [{ rule: "DUPLICATE_ASSIGNMENT" }, "RULE_VIOLATION"],
    [{ rule: "OUTSIDE_PERIOD" }, "RULE_VIOLATION"],
  ])("%o is %s", (v, category) => {
    expect(validationCategory(v as Violation)).toBe(category);
  });
});

describe("summarizeValidation", () => {
  it("counts undecided nurse-days and the days they affect; OFF is a decision", () => {
    const summary = summarize(
      [a("sara", "2026-11-01", "OFF"), a("ali", "2026-11-01", "OFF")],
      { roster: ["sara", "ali"] },
    );
    expect(summary).toMatchObject({ undecided: 4, undecidedDays: 2 });
    // OFF on day 1 is complete: two explicit decisions, nothing undecided.
    expect(summary.days[0]).toMatchObject({
      decisions: 2,
      undecided: 0,
      ready: true,
      state: "READY",
    });
  });

  it("an undecided nurse-day is never a rule violation", () => {
    const summary = summarize([a("sara", "2026-11-01", "M")], {
      roster: ["sara", "ali"],
    });
    expect(summary.ruleViolations).toBe(0);
    expect(summary.days[0]).toMatchObject({
      undecided: 1,
      ruleViolations: 0,
      state: "UNDECIDED",
    });
  });

  it("counts coverage problems per bucket with shortage and excess amounts", () => {
    const nights = ["a", "b", "c", "d", "e", "f", "g"].map((n) =>
      a(n, "2026-11-01", "N"),
    );
    const summary = summarize([...nights, a("x", "2026-11-01", "ME")], {
      requirement: { M: pilot, E: pilot, N: pilot },
    });
    // Day 1: M 1/3 and E 1/3 short, N 7/6 over. Days 2–3: M, E, N short by 3.
    expect(summary.days[0]).toMatchObject({
      shortages: 2,
      overstaffing: 1,
      state: "COVERAGE",
    });
    expect(summary).toMatchObject({
      coverageProblems: 9,
      shortages: 8,
      overstaffing: 1,
      shortBy: 2 + 2 + 3 * 6,
      excessBy: 1,
    });
  });

  it("ME adds one to M and one to E (2 M + 1 ME = Morning 3)", () => {
    const summary = summarize(
      [
        a("a", "2026-11-01", "M"),
        a("b", "2026-11-01", "M"),
        a("c", "2026-11-01", "ME"),
        a("d", "2026-11-01", "E"),
        a("e", "2026-11-01", "E"),
      ],
      { requirement: { M: pilot, E: pilot } },
    );
    expect(summary.days[0]).toMatchObject({ shortages: 0, ready: true });
  });

  it("shows NOT_STARTED for a day without any decision, still not ready", () => {
    const summary = summarize([], {
      roster: ["sara"],
      requirement: { M: pilot },
    });
    expect(summary.days.map((x) => x.state)).toEqual([
      "NOT_STARTED",
      "NOT_STARTED",
      "NOT_STARTED",
    ]);
    expect(summary.days[0]).toMatchObject({
      undecided: 1,
      shortages: 1,
      ready: false,
    });
    expect(summary.ready).toBe(false);
  });

  it("orders severity: rule violation > coverage > undecided", () => {
    const summary = summarize(
      [
        a("sara", "2026-11-01", "N"),
        a("sara", "2026-11-02", "M"),
        a("ali", "2026-11-03", "M"),
      ],
      { roster: ["sara", "ali"], requirement: { M: { min: 1 } } },
    );
    // Day 2: night rest after day 1's Night (D43 attributes it to day 2).
    expect(summary.days.map((x) => x.state)).toEqual([
      "COVERAGE",
      "RULE_VIOLATION",
      "UNDECIDED",
    ]);
    expect(summary.days[1]).toMatchObject({
      ruleViolations: 1,
      undecided: 1,
    });
  });

  it("counts rule violations outside the period once for the month", () => {
    const summary = summarize([a("sara", "2026-12-01", "M")]);
    expect(summary).toMatchObject({
      ruleViolations: 1,
      unattributedRuleViolations: 1,
      readyDays: 3,
      ready: false,
    });
  });

  it("is ready when every category is clean", () => {
    const summary = summarize(
      [
        a("sara", "2026-11-01", "M"),
        a("sara", "2026-11-02", "OFF"),
        a("sara", "2026-11-03", "E"),
      ],
      { roster: ["sara"] },
    );
    expect(summary).toMatchObject({ readyDays: 3, totalDays: 3, ready: true });
    expect(validationCounts(summary)).toEqual({
      undecided: 0,
      undecidedDays: 0,
      coverageProblems: 0,
      shortages: 0,
      overstaffing: 0,
      shortBy: 0,
      excessBy: 0,
      ruleViolations: 0,
      readyDays: 3,
      totalDays: 3,
    });
  });

  it("lists every state", () => {
    expect(DAY_STATES).toHaveLength(5);
  });
});

describe("coverageProblems", () => {
  it("sorts by date then bucket", () => {
    const violations = validateSchedule({
      period,
      assignments: [],
      staffingRequirements: new Map([
        [d("2026-11-02"), { N: { min: 1 }, M: { min: 1 } }],
        [d("2026-11-01"), { E: { min: 1 } }],
      ]),
    });
    expect(
      coverageProblems(violations).map((p) => `${p.date}${p.period}`),
    ).toEqual(["2026-11-01E", "2026-11-02M", "2026-11-02N"]);
  });
});

describe("compareValidation (Apply preview, D107)", () => {
  const assignments = [
    a("a", "2026-11-01", "M"),
    a("b", "2026-11-01", "M"),
    a("c", "2026-11-01", "M"),
    a("d", "2026-11-02", "M"),
    a("e", "2026-11-02", "M"),
    a("f", "2026-11-02", "M"),
    a("g", "2026-11-02", "M"),
  ];
  const under = (requirement: StaffingRequirement) =>
    validateSchedule({
      period: { start: d("2026-11-01"), end: d("2026-11-02") },
      assignments,
      staffingRequirements: new Map([
        [d("2026-11-01"), requirement],
        [d("2026-11-02"), requirement],
      ]),
    });
  const compare = (before: StaffingRequirement, after: StaffingRequirement) =>
    compareValidation({
      period: { start: d("2026-11-01"), end: d("2026-11-02") },
      assignments,
      before: under(before),
      after: under(after),
    });

  it("reports new problems, readiness changes and the days to repair", () => {
    const impact = compare({ M: { min: 1 } }, { M: { min: 4, max: 6 } });
    expect(impact.before).toMatchObject({ coverageProblems: 0, readyDays: 2 });
    expect(impact.after).toMatchObject({
      coverageProblems: 1,
      shortages: 1,
      readyDays: 1,
    });
    expect(impact.becameNotReady).toEqual(["2026-11-01"]);
    expect(impact.becameReady).toEqual([]);
    expect(impact.introduced).toMatchObject([
      { date: "2026-11-01", period: "M", kind: "SHORTAGE", amount: 1 },
    ]);
    expect(impact.datesToRepair).toEqual(["2026-11-01"]);
    expect(impact.resolved).toEqual([]);
  });

  it("treats a worse shortage as introduced and an unchanged one as not", () => {
    const worse = compare({ M: { min: 4 } }, { M: { min: 5 } });
    expect(worse.introduced.map((p) => p.date)).toEqual([
      "2026-11-01",
      "2026-11-02",
    ]);
    const same = compare({ M: { min: 4 } }, { M: { min: 4, max: 9 } });
    expect(same.introduced).toEqual([]);
    expect(same.coverageAfter).toHaveLength(1);
  });

  it("reports resolved problems and days that become ready (rollback)", () => {
    const impact = compare({ M: { min: 3, max: 3 } }, { M: { min: 1 } });
    expect(impact.resolved).toMatchObject([
      { date: "2026-11-02", kind: "OVERSTAFFING", amount: 1 },
    ]);
    expect(impact.becameReady).toEqual(["2026-11-02"]);
    expect(impact.datesToRepair).toEqual([]);
  });
});
