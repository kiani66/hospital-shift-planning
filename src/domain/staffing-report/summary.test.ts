import { describe, expect, it } from "vitest";

import { bounds, content } from "../../../tests/support/staffing-rules";
import { findStaffingViolations } from "../rules/staffing";
import { addDays, dayOfWeek, isoDate, type IsoDate } from "../shared/dates";
import { ValidationError } from "../shared/errors";
import { periodDays, type DatePeriod } from "../shared/period";
import { unwrap } from "../shared/result";
import type { Assignment } from "../shifts/assignment";
import { ASSIGNMENT_CODES, type AssignmentCode } from "../shifts/shift-type";
import { resolveRequirements } from "../staffing-rules/resolve";
import {
  summarizeStaffing,
  type StaffingReportInput,
  type StaffingRosterMember,
} from "./summary";

const date = isoDate("2026-10-23"); // Friday; not a staffing holiday by itself.
const period = { start: date, end: date };
const roster: readonly StaffingRosterMember[] = [
  { userId: "nurse", role: "NURSE" },
];
const assignment = (
  shift: AssignmentCode,
  nurseId = "nurse",
  on = date,
): Assignment => ({ nurseId, date: on, shift });
const input = (
  overrides: Partial<StaffingReportInput> = {},
): StaffingReportInput => ({
  period,
  roster,
  assignments: [],
  ruleSet: content(),
  officialHolidays: new Set(),
  ...overrides,
});
const report = (overrides: Partial<StaffingReportInput> = {}) =>
  unwrap(summarizeStaffing(input(overrides)));
const noMinimum = content({
  normal: { M: bounds(0), E: bounds(0), N: bounds(0) },
});

describe("summarizeStaffing coverage and historical roster", () => {
  it.each([
    ["M", [1, 0, 0]],
    ["E", [0, 1, 0]],
    ["N", [0, 0, 1]],
    ["ME", [1, 1, 0]],
    ["OFF", [0, 0, 0]],
    ["H", [0, 0, 0]],
  ] as const)(
    "counts %s by its existing coverage semantics",
    (shift, expected) => {
      const assignments = [assignment(shift)];
      const result = report({ assignments });
      expect(result.rows.map((r) => r.covered)).toEqual(expected);
      expect(result.undecidedNurseDays).toBe(0);
      expect(assignments).toHaveLength(1); // ME remains one stored decision.
    },
  );

  it.each(ASSIGNMENT_CODES)(
    "excludes Secretary %s from nursing min and max",
    (shift) => {
      const secretary = { userId: "secretary", role: "SECRETARY" } as const;
      const overrides = {
        roster: [...roster, secretary],
        assignments: [assignment("ME"), assignment(shift, "secretary")],
        ruleSet: content({
          normal: { M: bounds(1, 1), E: bounds(1, 1), N: bounds(0, 0) },
        }),
      };
      const result = report(overrides);
      expect(result.rows.map((r) => [r.covered, r.status])).toEqual([
        [1, "WITHIN_BOUNDS"],
        [1, "WITHIN_BOUNDS"],
        [0, "WITHIN_BOUNDS"],
      ]);
      expect(result.undecidedNurseDays).toBe(0);
      expect(
        report({
          ...overrides,
          roster: [secretary],
          assignments: [assignment(shift, "secretary")],
        }).rows.map((r) => r.covered),
      ).toEqual([0, 0, 0]);
      expect(report({ roster: [secretary] }).undecidedNurseDays).toBe(0);
    },
  );

  it("includes Head Nurses and ignores current inactivity and membership dates", () => {
    const historicalRoster = [
      {
        userId: "nurse",
        role: "NURSE",
        isActive: false,
        endedOn: addDays(date, -1),
      },
      {
        userId: "head",
        role: "HEAD_NURSE",
        isActive: false,
        startedOn: addDays(date, 1),
      },
    ] as const;
    const result = report({
      roster: historicalRoster,
      assignments: [assignment("ME"), assignment("N", "head")],
    });
    expect(result.rows.map((r) => r.covered)).toEqual([1, 1, 1]);
    expect(result.undecidedNurseDays).toBe(0);
  });

  it("keeps missing UNDECIDED distinct from explicit OFF and H", () => {
    const undecided = report();
    expect(undecided.rows.map((r) => r.covered)).toEqual([0, 0, 0]);
    expect(undecided.undecidedNurseDays).toBe(1);
    for (const code of ["OFF", "H"] as const) {
      const explicit = report({ assignments: [assignment(code)] });
      expect(explicit.rows).toEqual(undecided.rows);
      expect(explicit.undecidedNurseDays).toBe(0);
    }
  });

  it("reports all zero-coverage buckets for an empty roster", () => {
    const result = report({ roster: [] });
    expect(result.rows.map((r) => [r.covered, r.status, r.gap])).toEqual([
      [0, "SHORTAGE", 3],
      [0, "SHORTAGE", 3],
      [0, "SHORTAGE", 3],
    ]);
    expect(result.totals).toEqual({
      totalBuckets: 3,
      shortageBuckets: 3,
      shortageDays: 1,
      shortagePersonPeriods: 9,
      excessBuckets: 0,
      excessDays: 0,
      excessPersonPeriods: 0,
      withinBoundsBuckets: 0,
    });
    expect(result.undecidedNurseDays).toBe(0);
  });
});

describe("staffing bounds and aggregate units", () => {
  it.each([
    [2, "SHORTAGE", 1],
    [3, "WITHIN_BOUNDS", 0],
    [6, "WITHIN_BOUNDS", 0],
    [7, "EXCESS", 1],
  ] as const)(
    "compares %i people against inclusive bounds 3–6",
    (count, status, gap) => {
      const people = Array.from({ length: count }, (_, i) => ({
        userId: `n${i}`,
        role: "NURSE" as const,
      }));
      const result = report({
        roster: people,
        assignments: people.map((r) => assignment("M", r.userId)),
      });
      expect(result.rows[0]).toEqual({
        date,
        period: "M",
        covered: count,
        min: 3,
        max: 6,
        status,
        gap,
        source: "NORMAL",
      });
    },
  );

  it("allows unlimited coverage when maximum is null and respects a zero minimum", () => {
    const result = report({
      ruleSet: noMinimum,
      assignments: [assignment("ME")],
    });
    expect(result.rows.map((r) => [r.min, r.max, r.status, r.gap])).toEqual([
      [0, null, "WITHIN_BOUNDS", 0],
      [0, null, "WITHIN_BOUNDS", 0],
      [0, null, "WITHIN_BOUNDS", 0],
    ]);
    expect(result.totals.withinBoundsBuckets).toBe(3);
  });

  it("separates affected dates, affected buckets and person-period gaps without cancellation", () => {
    const end = addDays(date, 1);
    const people = ["a", "b", "c"].map((userId) => ({
      userId,
      role: "NURSE" as const,
    }));
    const result = report({
      period: { start: date, end },
      roster: people,
      assignments: [
        assignment("ME", "a"),
        assignment("ME", "b"),
        assignment("N", "c"),
        assignment("ME", "a", end),
        assignment("ME", "b", end),
        assignment("N", "c", end),
      ],
      ruleSet: content({
        normal: { M: bounds(4, 4), E: bounds(0, 1), N: bounds(0, 0) },
      }),
    });
    expect(result.totals).toEqual({
      totalBuckets: 6,
      shortageBuckets: 2,
      shortageDays: 2,
      shortagePersonPeriods: 4,
      excessBuckets: 4,
      excessDays: 2,
      excessPersonPeriods: 4,
      withinBoundsBuckets: 0,
    });
    // Equal shortage/excess magnitudes remain separate problems on the same dates.
    expect(result.rows.map((r) => r.gap)).toEqual([2, 1, 1, 2, 1, 1]);
  });

  it("agrees with existing staffing violations for every reported problem", () => {
    const data = input({
      assignments: [assignment("ME")],
      ruleSet: content({
        normal: { M: bounds(3), E: bounds(0, 0), N: bounds(0) },
      }),
    });
    const result = unwrap(summarizeStaffing(data));
    const findings = findStaffingViolations({
      period,
      assignments: data.assignments,
      requirements: resolveRequirements(
        data.ruleSet,
        [date],
        data.officialHolidays,
      ),
    });
    expect(
      result.rows
        .filter((r) => r.status !== "WITHIN_BOUNDS")
        .map((r) => [r.date, r.period, r.covered, r.status]),
    ).toEqual(
      findings.map((v) => [
        v.date,
        v.period,
        v.covered,
        v.status === "BELOW_MINIMUM" ? "SHORTAGE" : "EXCESS",
      ]),
    );
    expect(result.totals.withinBoundsBuckets).toBe(1);
  });

  it("reports staffing compliance without deriving scheduling readiness", () => {
    // Consecutive nights violate existing night-rest rules; staffing remains within bounds.
    const result = report({
      period: { start: date, end: addDays(date, 1) },
      ruleSet: noMinimum,
      assignments: [
        assignment("N"),
        assignment("N", "nurse", addDays(date, 1)),
      ],
    });
    expect(result.totals.withinBoundsBuckets).toBe(6);
    expect(result).not.toHaveProperty("ready");
    expect(result).not.toHaveProperty("isComplete");
    expect(report({ ruleSet: noMinimum }).undecidedNurseDays).toBe(1);
  });
});

describe("pinned requirement resolution", () => {
  const ruleSet = content({
    holiday: { M: bounds(2, 4), E: bounds(0, 1) },
    exceptions: [
      { date, period: "M", bounds: bounds(5, 7), note: "specific day" },
    ],
  });
  it.each([false, true])(
    "uses the date exception before normal/holiday (official: %s)",
    (holiday) => {
      const result = report({
        ruleSet,
        officialHolidays: new Set(holiday ? [date] : []),
      });
      expect(result.rows[0]).toMatchObject({
        min: 5,
        max: 7,
        source: "EXCEPTION",
        gap: 5,
      });
      expect(result.rows[1]!.source).toBe(holiday ? "HOLIDAY" : "NORMAL");
      expect(result.rows[2]!.source).toBe("NORMAL");
    },
  );
  it("uses official holiday bounds per bucket with normal fallback", () => {
    const result = report({
      ruleSet: { ...ruleSet, exceptions: [] },
      officialHolidays: new Set([date]),
    });
    expect(result.rows.map((r) => [r.min, r.max, r.source])).toEqual([
      [2, 4, "HOLIDAY"],
      [0, 1, "HOLIDAY"],
      [3, 6, "NORMAL"],
    ]);
  });
  it("uses normal rules on Friday without official holiday data", () => {
    expect(dayOfWeek(date)).toBe(5);
    expect(
      report({ ruleSet: { ...ruleSet, exceptions: [] } }).rows.map(
        (r) => r.source,
      ),
    ).toEqual(["NORMAL", "NORMAL", "NORMAL"]);
  });
  it("does not add report rows for holidays or reusable rule exceptions outside the period", () => {
    const outside = addDays(date, 1);
    const result = report({
      ruleSet: {
        ...ruleSet,
        exceptions: [
          { date: outside, period: "N", bounds: bounds(9), note: null },
        ],
      },
      officialHolidays: new Set([outside]),
    });
    expect(result.rows).toHaveLength(3);
    expect(result.rows.every((r) => r.source === "NORMAL")).toBe(true);
  });
});

describe("actual period, conservation and determinism", () => {
  it.each([
    ["2026-10-10", "2026-10-12", 3],
    ["2026-03-19", "2026-03-23", 5], // Jalali year boundary, domain stays ISO.
    ["2026-12-30", "2027-01-02", 4],
    ["2028-02-28", "2028-03-01", 3],
    ["2026-10-01", "2026-12-01", 62],
  ])(
    "keeps exactly the inclusive ISO period %s..%s (%i days)",
    (start, end, count) => {
      const selected = { start: isoDate(start), end: isoDate(end) };
      const result = report({
        period: selected,
        assignments: [assignment("N", "nurse", selected.end)],
      });
      expect(result.period).toEqual(selected);
      expect(result.reportingDayCount).toBe(count);
      expect(result.undecidedNurseDays).toBe(count - 1);
      expect(result.rows.map((r) => [r.date, r.period])).toEqual(
        periodDays(selected).flatMap((d) => [
          [d, "M"],
          [d, "E"],
          [d, "N"],
        ]),
      );
      expect(result.rows.at(-1)).toMatchObject({
        date: selected.end,
        period: "N",
        covered: 1,
      });
      expect(result.rows).toHaveLength(count * 3);
      expect(result.totals.totalBuckets).toBe(count * 3);
      expect(
        result.totals.shortageBuckets +
          result.totals.excessBuckets +
          result.totals.withinBoundsBuckets,
      ).toBe(count * 3);
    },
  );
  it("includes every date of a fully undecided schedule", () => {
    const result = report({ period: { start: date, end: addDays(date, 2) } });
    expect(result.rows).toHaveLength(9);
    expect(result.undecidedNurseDays).toBe(3);
    expect(result.totals).toMatchObject({
      shortageBuckets: 9,
      shortageDays: 3,
      shortagePersonPeriods: 27,
    });
  });
  it("is independent of roster, assignment, holiday and exception input order without mutation", () => {
    const next = addDays(date, 1);
    const data = input({
      period: { start: date, end: next },
      roster: [...roster, { userId: "head", role: "HEAD_NURSE" }],
      assignments: [assignment("M", "head", next), assignment("ME")],
      officialHolidays: new Set([next, date]),
      ruleSet: content({
        exceptions: [
          { date: next, period: "E", bounds: bounds(0), note: null },
          { date, period: "N", bounds: bounds(0), note: null },
        ],
      }),
    });
    const before = structuredClone(data);
    const result = unwrap(summarizeStaffing(data));
    expect(
      unwrap(
        summarizeStaffing({
          ...data,
          roster: [...data.roster].reverse(),
          assignments: [...data.assignments].reverse(),
          officialHolidays: new Set([...data.officialHolidays].reverse()),
          ruleSet: {
            ...data.ruleSet,
            exceptions: [...data.ruleSet.exceptions].reverse(),
          },
        }),
      ),
    ).toEqual(result);
    expect(data).toEqual(before);
    expect(unwrap(summarizeStaffing(data))).toEqual(result);
  });
});

describe("invalid inputs return domain ValidationError", () => {
  const invalid = (overrides: Partial<StaffingReportInput>) => {
    const result = summarizeStaffing(input(overrides));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected invalid report input");
    expect(result.error).toBeInstanceOf(ValidationError);
    expect(result.error.code).toBe("VALIDATION");
    return result.error;
  };
  it.each([
    { start: date, end: addDays(date, -1) },
    { start: date, end: addDays(date, 62) },
    { start: "2026-02-30", end: date },
    { start: date, end: "bad" },
  ])("rejects an invalid period %j", (period) => {
    invalid({ period: period as DatePeriod });
  });
  it.each(["M", "E"] as const)(
    "rejects duplicate nurse-days, including %s duplicates",
    (shift) => {
      expect(
        invalid({ assignments: [assignment("M"), assignment(shift)] }).field,
      ).toBe("assignments");
    },
  );
  it("validates Secretary decisions before excluding them from coverage", () => {
    invalid({
      roster: [{ userId: "secretary", role: "SECRETARY" }],
      assignments: [
        assignment("M", "secretary"),
        assignment("ME", "secretary"),
      ],
    });
  });
  it("rejects non-roster assignments", () => {
    expect(invalid({ assignments: [assignment("M", "stranger")] }).field).toBe(
      "nurseId",
    );
  });
  it.each([
    addDays(date, -1),
    addDays(date, 1),
    "2026-10-32",
    "2026-10-23T00:00:00Z",
    "2026-10-23x",
  ])("rejects invalid/out-of-period assignment date %s", (on) => {
    expect(
      invalid({ assignments: [assignment("M", "nurse", on as IsoDate)] }).field,
    ).toBe("date");
  });
  it.each(["UNDECIDED", "X", null])(
    "rejects an invalid explicit assignment %s instead of counting it as missing",
    (code) => {
      expect(
        invalid({ assignments: [assignment(code as AssignmentCode)] }).field,
      ).toBe("shift");
    },
  );
  it("rejects duplicate roster identities even with different roles", () => {
    invalid({ roster: [...roster, ...roster] });
    invalid({ roster: [...roster, { userId: "nurse", role: "SECRETARY" }] });
  });
  it.each([
    { userId: "", role: "NURSE" },
    { userId: " ", role: "NURSE" },
    { userId: null, role: "NURSE" },
    { userId: "nurse", role: "SUPERVISOR" },
    { userId: "nurse", role: null },
  ])("rejects malformed roster entry %j", (member) => {
    expect(invalid({ roster: [member as StaffingRosterMember] }).field).toBe(
      "roster",
    );
  });
  it("uses the existing rule-set content validation", () => {
    invalid({
      ruleSet: content({
        normal: { M: bounds(-1), E: bounds(0), N: bounds(0) },
      }),
    });
    invalid({
      ruleSet: content({
        normal: { M: bounds(3, 2), E: bounds(0), N: bounds(0) },
      }),
    });
    invalid({
      ruleSet: content({ normal: { E: bounds(0), N: bounds(0) } as never }),
    });
    invalid({ ruleSet: content({ holiday: { M: bounds(0, -1) } }) });
    const exception = {
      date,
      period: "M" as const,
      bounds: bounds(0),
      note: null,
    };
    invalid({ ruleSet: content({ exceptions: [exception, exception] }) });
    invalid({
      ruleSet: content({
        exceptions: [{ ...exception, period: "ME" as never }],
      }),
    });
  });
  it("rejects malformed official holiday dates", () => {
    expect(
      invalid({ officialHolidays: new Set(["2026-02-30" as IsoDate]) }).field,
    ).toBe("officialHolidays");
  });
});
