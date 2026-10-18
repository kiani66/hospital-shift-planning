import { describe, expect, it } from "vitest";

import { addDays, isoDate } from "../shared/dates";
import { ValidationError } from "../shared/errors";
import { periodDays, type DatePeriod } from "../shared/period";
import { unwrap } from "../shared/result";
import type { Assignment } from "../shifts/assignment";
import {
  ASSIGNMENT_CODES,
  SHIFT_TYPES,
  shiftDurationMinutes,
  type AssignmentCode,
} from "../shifts/shift-type";
import { summarizeWorkforce, type WorkforceRosterMember } from "./summary";

const start = isoDate("2026-10-10");
const roster: readonly WorkforceRosterMember[] = [
  { userId: "nurse", role: "NURSE" },
];
const periodOf = (length: number): DatePeriod => ({
  start,
  end: addDays(start, length - 1),
});
const decision = (
  shift: AssignmentCode,
  date = start,
  nurseId = "nurse",
): Assignment => ({ nurseId, date, shift });
const summarize = (length: number, assignments: readonly Assignment[] = []) =>
  unwrap(summarizeWorkforce({ period: periodOf(length), roster, assignments }));

describe("summarizeWorkforce", () => {
  it.each([
    ["M", 420],
    ["E", 300],
    ["N", 720],
    ["ME", 720],
  ] as const)(
    "counts %s as one working shift with %i catalog minutes",
    (code, minutes) => {
      const row = summarize(1, [decision(code)]).rows[0]!;
      expect(row.counts[code]).toBe(1);
      expect(row.workingShiftCount).toBe(1);
      expect(row.scheduledMinutes).toBe(minutes);
      expect(row.scheduledMinutes).toBe(
        shiftDurationMinutes(SHIFT_TYPES[code]),
      );
      expect(row.isComplete).toBe(true);
    },
  );

  it("keeps numeric recorded totals and distinguishes OFF, H and absence", () => {
    const report = summarize(7, [
      decision("M"),
      decision("E", addDays(start, 1)),
      decision("N", addDays(start, 2)),
      decision("ME", addDays(start, 3)),
      decision("OFF", addDays(start, 4)),
      decision("H", addDays(start, 5)),
    ]);
    expect(report.isComplete).toBe(false);
    expect(report.rows[0]).toMatchObject({
      counts: { M: 1, E: 1, N: 1, ME: 1, OFF: 1, H: 1, UNDECIDED: 1 },
      workingShiftCount: 4,
      scheduledMinutes: 2160,
      reportingDayCount: 7,
      isComplete: false,
    });
    expect(report.rows[0]!.days.slice(4)).toEqual([
      { date: addDays(start, 4), decision: "OFF" },
      { date: addDays(start, 5), decision: "H" },
      { date: addDays(start, 6), decision: null },
    ]);
  });

  it("uses both inclusive boundaries of a partial period and keeps the last night whole", () => {
    const report = summarize(3, [
      decision("M"),
      decision("N", addDays(start, 2)),
    ]);
    expect(report.period).toEqual(periodOf(3));
    expect(report.reportingDayCount).toBe(3);
    expect(report.rows[0]!.days).toEqual([
      { date: start, decision: "M" },
      { date: addDays(start, 1), decision: null },
      { date: addDays(start, 2), decision: "N" },
    ]);
    expect(report.rows[0]!.scheduledMinutes).toBe(1140);
  });

  it.each([29, 30, 31, 62])(
    "includes zero-decision roster members for all %i days",
    (length) => {
      const report = summarize(length);
      expect(report.reportingDayCount).toBe(length);
      expect(report.rows).toHaveLength(1);
      expect(report.rows[0]).toMatchObject({
        counts: { M: 0, E: 0, N: 0, ME: 0, OFF: 0, H: 0, UNDECIDED: length },
        workingShiftCount: 0,
        scheduledMinutes: 0,
        reportingDayCount: length,
        isComplete: false,
      });
      expect(report.rows[0]!.days).toHaveLength(length);
    },
  );

  it.each(["OFF", "H"] as const)(
    "an all-%s period is complete with zero working totals",
    (code) => {
      const report = summarize(
        30,
        periodDays(periodOf(30)).map((date) => decision(code, date)),
      );
      expect(report.isComplete).toBe(true);
      expect(report.rows[0]).toMatchObject({
        workingShiftCount: 0,
        scheduledMinutes: 0,
        isComplete: true,
        counts: {
          OFF: code === "OFF" ? 30 : 0,
          H: code === "H" ? 30 : 0,
          UNDECIDED: 0,
        },
      });
    },
  );

  it("includes Head Nurse, Secretary and historical members without trimming membership dates", () => {
    const historicalRoster = [
      {
        userId: "secretary",
        role: "SECRETARY",
        startedOn: addDays(start, 1),
        endedOn: null,
      },
      { userId: "nurse", role: "NURSE", startedOn: start, endedOn: start },
      { userId: "head", role: "HEAD_NURSE", startedOn: start, endedOn: null },
    ] as const;
    const report = unwrap(
      summarizeWorkforce({
        period: periodOf(3),
        roster: historicalRoster,
        assignments: [
          decision("ME", start, "secretary"),
          decision("N", addDays(start, 2)),
          decision("H", start, "head"),
        ],
      }),
    );
    expect(report.rows.map((r) => [r.userId, r.role])).toEqual([
      ["head", "HEAD_NURSE"],
      ["nurse", "NURSE"],
      ["secretary", "SECRETARY"],
    ]);
    for (const row of report.rows) {
      expect(row.reportingDayCount).toBe(3);
      expect(row.counts.UNDECIDED).toBe(2);
    }
    expect(report.rows[1]!.scheduledMinutes).toBe(720);
    expect(report.rows[2]!.scheduledMinutes).toBe(720);
  });

  it("is complete only when every roster member has every day's decision", () => {
    const people = [...roster, { userId: "head", role: "HEAD_NURSE" } as const];
    const assignments = [
      decision("M"),
      decision("OFF", addDays(start, 1)),
      decision("H", start, "head"),
    ];
    const input = { period: periodOf(2), roster: people, assignments };
    const partial = unwrap(summarizeWorkforce(input));
    expect(partial.rows.map((r) => r.isComplete)).toEqual([false, true]);
    expect(partial.isComplete).toBe(false);
    expect(
      unwrap(
        summarizeWorkforce({
          ...input,
          assignments: [
            ...assignments,
            decision("ME", addDays(start, 1), "head"),
          ],
        }),
      ).isComplete,
    ).toBe(true);
  });

  it("conserves all seven counts across mixed 29-, 30- and 31-day reports", () => {
    const codes = [...ASSIGNMENT_CODES, null];
    for (const length of [29, 30, 31]) {
      const assignments = periodDays(periodOf(length)).flatMap((date, i) => {
        const code = codes[i % codes.length]!;
        return code === null ? [] : [decision(code, date)];
      });
      const row = summarize(length, assignments).rows[0]!;
      expect(Object.values(row.counts).reduce((sum, n) => sum + n, 0)).toBe(
        length,
      );
      expect(row.workingShiftCount).toBe(
        row.counts.M + row.counts.E + row.counts.N + row.counts.ME,
      );
      expect(row.scheduledMinutes).toBe(
        row.counts.M * shiftDurationMinutes(SHIFT_TYPES.M) +
          row.counts.E * shiftDurationMinutes(SHIFT_TYPES.E) +
          row.counts.N * shiftDurationMinutes(SHIFT_TYPES.N) +
          row.counts.ME * shiftDurationMinutes(SHIFT_TYPES.ME),
      );
      expect(Number.isInteger(row.scheduledMinutes)).toBe(true);
    }
  });

  it("is independent of input ordering and leaves frozen inputs unchanged", () => {
    const people = Object.freeze([
      Object.freeze({ userId: "c", role: "SECRETARY" } as const),
      Object.freeze({ userId: "a", role: "HEAD_NURSE" } as const),
      Object.freeze({ userId: "b", role: "NURSE" } as const),
    ]);
    const assignments = Object.freeze([
      Object.freeze(decision("N", addDays(start, 1), "a")),
      Object.freeze(decision("H", start, "c")),
      Object.freeze(decision("ME", start, "b")),
    ]);
    const period = Object.freeze(periodOf(2));
    const report = unwrap(
      summarizeWorkforce({ period, roster: people, assignments }),
    );
    expect(report.rows.map((r) => r.userId)).toEqual(["a", "b", "c"]);
    expect(
      summarizeWorkforce({
        period,
        roster: [...people].reverse(),
        assignments: [...assignments].reverse(),
      }),
    ).toEqual({ ok: true, value: report });
    expect(people.map((r) => r.userId)).toEqual(["c", "a", "b"]);
    expect(assignments[0]!.shift).toBe("N");
  });

  it("returns an empty, complete report for an empty roster", () => {
    expect(
      unwrap(
        summarizeWorkforce({
          period: periodOf(1),
          roster: [],
          assignments: [],
        }),
      ),
    ).toEqual({
      period: periodOf(1),
      reportingDayCount: 1,
      rows: [],
      isComplete: true,
    });
  });

  it.each([
    ["identical duplicate", [decision("M"), decision("M")], "assignments"],
    ["conflicting duplicate", [decision("M"), decision("H")], "assignments"],
    ["before period", [decision("M", addDays(start, -1))], "date"],
    ["after period", [decision("N", addDays(start, 2))], "date"],
    ["non-roster member", [decision("M", start, "other")], "nurseId"],
  ] as const)(
    "rejects %s instead of dropping or double-counting it",
    (_, assignments, field) => {
      const result = summarizeWorkforce({
        period: periodOf(2),
        roster,
        assignments,
      });
      expect(result).toMatchObject({
        ok: false,
        error: { code: "VALIDATION", field },
      });
      if (!result.ok) expect(result.error).toBeInstanceOf(ValidationError);
    },
  );

  it("rejects duplicate roster identities", () => {
    expect(
      summarizeWorkforce({
        period: periodOf(1),
        roster: [...roster, ...roster],
        assignments: [],
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "VALIDATION", field: "roster" },
    });
  });

  it.each([0, 63])(
    "rejects an invalid %i-day schedule period through createPeriod",
    (length) => {
      expect(
        summarizeWorkforce({
          period: periodOf(length),
          roster,
          assignments: [],
        }),
      ).toMatchObject({
        ok: false,
        error: { code: "VALIDATION", field: "periodEnd" },
      });
    },
  );
});
