import { describe, expect, it } from "vitest";

import { isoDate } from "../shared/dates";
import { applyAssignmentEdits } from "../schedule/schedule-change";
import type { Assignment } from "../shifts/assignment";
import type { AssignmentCode, ShiftCode } from "../shifts/shift-type";
import { assessChange, staffingImpact } from "./assess-change";
import type { StaffingRequirement } from "./staffing";
import { validateSchedule } from "./validate-schedule";

const d = isoDate;
const period = { start: d("2026-10-23"), end: d("2026-11-21") };
const a = (nurseId: string, date: string, shift: ShiftCode): Assignment => ({
  nurseId,
  date: d(date),
  shift,
});

/** Validates before and after a change of `edits`, as the application will. */
function assess(
  before: Assignment[],
  edits: { nurseId: string; date: string; shift: AssignmentCode | null }[],
  staffingRequirements?: ReadonlyMap<ReturnType<typeof d>, StaffingRequirement>,
) {
  const typed = edits.map((e) => ({ ...e, date: d(e.date) }));
  const after = applyAssignmentEdits(before, typed);
  return assessChange({
    before: validateSchedule({
      period,
      assignments: before,
      staffingRequirements,
    }),
    after: validateSchedule({
      period,
      assignments: after,
      staffingRequirements,
    }),
    changedCells: typed,
  });
}

describe("assessChange", () => {
  it("blocks a change that introduces a hard violation (night rest, D7)", () => {
    const result = assess(
      [a("sara", "2026-10-25", "N")],
      [{ nurseId: "sara", date: "2026-10-26", shift: "M" }],
    );
    expect(result.blocked).toBe(true);
    expect(result.blocking.map((v) => v.rule)).toEqual(["NIGHT_REST"]);
    expect(result.warnings).toEqual([]);
  });

  it("blocks a Night that makes an existing next-day shift violate", () => {
    const result = assess(
      [a("sara", "2026-10-26", "M"), a("sara", "2026-10-25", "E")],
      [{ nurseId: "sara", date: "2026-10-25", shift: "N" }],
    );
    expect(result.blocked).toBe(true);
  });

  it("does not block on a pre-existing, unrelated hard violation", () => {
    const result = assess(
      [
        a("ali", "2026-10-25", "N"),
        a("ali", "2026-10-26", "M"), // unrelated night-rest finding
        a("sara", "2026-10-27", "M"),
      ],
      [{ nurseId: "sara", date: "2026-10-27", shift: "E" }],
    );
    expect(result.blocked).toBe(false);
    expect(result.introduced).toEqual([]);
    expect(result.persisting).toEqual([]);
  });

  it("does not block a change that keeps (but does not worsen) a finding on its cell", () => {
    // N→M becomes N→E: the same night-rest finding, not a new one.
    const result = assess(
      [a("sara", "2026-10-25", "N"), a("sara", "2026-10-26", "M")],
      [{ nurseId: "sara", date: "2026-10-26", shift: "E" }],
    );
    expect(result.blocked).toBe(false);
    expect(result.persisting.map((v) => v.rule)).toEqual(["NIGHT_REST"]);
  });

  it("allows a change that resolves a finding", () => {
    const result = assess(
      [a("sara", "2026-10-25", "N"), a("sara", "2026-10-26", "M")],
      [{ nurseId: "sara", date: "2026-10-26", shift: null }],
    );
    expect(result).toMatchObject({
      blocked: false,
      introduced: [],
      persisting: [],
    });
  });

  describe("staffing minima (blocking) and maxima (advisory)", () => {
    const requirements = new Map([[d("2026-10-25"), { M: { min: 2 } }]]);
    const staffed = [a("sara", "2026-10-25", "M"), a("ali", "2026-10-25", "M")];

    it("blocks a newly introduced staffing shortfall", () => {
      const result = assess(
        staffed,
        [{ nurseId: "sara", date: "2026-10-25", shift: null }],
        requirements,
      );
      expect(result.blocked).toBe(true);
      expect(result.warnings).toEqual([]);
      expect(result.blocking).toMatchObject([
        { rule: "STAFFING", period: "M", covered: 1, status: "BELOW_MINIMUM" },
      ]);
    });

    it("reports a worsened shortfall, and not an unchanged one", () => {
      const short = [
        a("sara", "2026-10-25", "M"),
        a("reza", "2026-10-25", "E"),
      ];
      const req = new Map([[d("2026-10-25"), { M: { min: 3 } }]]);
      const worse = assess(
        short,
        [{ nurseId: "sara", date: "2026-10-25", shift: null }],
        req,
      );
      expect(worse.blocking.map((v) => v.rule)).toEqual(["STAFFING"]);
      const same = assess(
        short,
        [{ nurseId: "reza", date: "2026-10-25", shift: "N" }],
        req,
      );
      expect(same.warnings).toEqual([]);
      expect(same.persisting.map((v) => v.rule)).toEqual(["STAFFING"]);
    });

    describe("maximum is a hard rule for changes too (D102)", () => {
      const req = new Map([[d("2026-10-25"), { N: { min: 1, max: 2 } }]]);
      const two = [a("sara", "2026-10-25", "N"), a("ali", "2026-10-25", "N")];

      it("blocks a change that introduces overstaffing", () => {
        const result = assess(
          two,
          [{ nurseId: "reza", date: "2026-10-25", shift: "N" }],
          req,
        );
        expect(result.blocked).toBe(true);
        expect(result.blocking).toMatchObject([
          { rule: "STAFFING", status: "ABOVE_MAXIMUM", covered: 3 },
        ]);
      });

      it("blocks a change that worsens existing overstaffing", () => {
        const three = [...two, a("reza", "2026-10-25", "N")];
        const result = assess(
          three,
          [{ nurseId: "maryam", date: "2026-10-25", shift: "N" }],
          req,
        );
        expect(result.blocked).toBe(true);
      });

      it("allows progressive repair of existing overstaffing", () => {
        const four = [
          ...two,
          a("reza", "2026-10-25", "N"),
          a("maryam", "2026-10-25", "N"),
        ];
        const result = assess(
          four,
          [{ nurseId: "maryam", date: "2026-10-25", shift: "OFF" }],
          req,
        );
        expect(result.blocked).toBe(false);
        expect(result.persisting).toMatchObject([
          { rule: "STAFFING", status: "ABOVE_MAXIMUM", covered: 3 },
        ]);
      });
    });

    it("blocks both night rest and staffing shortages", () => {
      const result = assess(
        staffed,
        [
          { nurseId: "ali", date: "2026-10-25", shift: null },
          { nurseId: "sara", date: "2026-10-24", shift: "N" },
        ],
        requirements,
      );
      expect(result.blocked).toBe(true);
      expect(result.blocking.map((v) => v.rule)).toEqual([
        "STAFFING",
        "NIGHT_REST",
      ]);
      expect(result.warnings).toEqual([]);
    });
  });
});

describe("staffingImpact", () => {
  it("shows coverage per period before and after, with the status after", () => {
    const before = [a("sara", "2026-10-25", "ME"), a("ali", "2026-10-25", "N")];
    const after = applyAssignmentEdits(before, [
      { nurseId: "sara", date: d("2026-10-25"), shift: "M" },
    ]);
    expect(
      staffingImpact({
        before,
        after,
        dates: [d("2026-10-25"), d("2026-10-25")],
        requirements: new Map([[d("2026-10-25"), { E: { min: 1 } }]]),
      }),
    ).toEqual([
      {
        date: "2026-10-25",
        periods: [
          {
            period: "M",
            before: 1,
            after: 1,
            bounds: null,
            status: "NOT_CONFIGURED",
          },
          {
            period: "E",
            before: 1,
            after: 0,
            bounds: { min: 1 },
            status: "BELOW_MINIMUM",
          },
          {
            period: "N",
            before: 1,
            after: 1,
            bounds: null,
            status: "NOT_CONFIGURED",
          },
        ],
      },
    ]);
  });

  it("reads NOT_CONFIGURED everywhere without requirements (D44)", () => {
    const [day] = staffingImpact({
      before: [],
      after: [a("sara", "2026-10-25", "M")],
      dates: [d("2026-10-25")],
    });
    expect(day!.periods.every((p) => p.status === "NOT_CONFIGURED")).toBe(true);
  });
});
