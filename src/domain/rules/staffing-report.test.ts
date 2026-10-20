import { describe, expect, it } from "vitest";

import { isoDate } from "../shared/dates";
import type { Assignment } from "../shifts/assignment";
import { composeStaffingReport } from "./staffing-report";
import type { StaffingRequirement } from "./staffing";

const d = (date: string) => isoDate(date);
const assignment = (nurseId: string, date: string, shift: Assignment["shift"]): Assignment => ({
  nurseId, date: d(date), shift,
});
const first = d("2026-10-31");
const second = d("2026-11-01");
const period = { start: first, end: second };
const requirements = new Map<ReturnType<typeof d>, StaffingRequirement>([
  [first, { M: { min: 2, max: 2 }, E: { min: 1, max: 1 }, N: { min: 0, max: 0 } }],
  [second, { M: { min: 0 }, E: { min: 1, max: 1 }, N: { min: 0 } }],
]);

describe("composeStaffingReport", () => {
  it("counts ME once in each covered period, includes head nurse, and excludes secretary", () => {
    const report = composeStaffingReport({
      period,
      nursingRosterIds: ["head", "nurse"],
      assignments: [
        assignment("head", "2026-10-31", "ME"),
        assignment("nurse", "2026-10-31", "OFF"),
        assignment("secretary", "2026-10-31", "M"),
        assignment("head", "2026-11-01", "H"),
      ],
      requirements,
    });
    expect(report.days[0].buckets.map((bucket) => bucket.covered)).toEqual([1, 1, 0]);
    expect(report.days[0].buckets.map((bucket) => bucket.shortage)).toEqual([1, 0, 0]);
    expect(report.days[0].undecidedNurses).toBe(0);
    expect(report.days[1].undecidedNurses).toBe(1);
    expect(report.totals).toMatchObject({
      affectedShortageDays: 2, shortageBuckets: 2, shortageAmount: 2,
      affectedExcessDays: 0, excessBuckets: 0, excessAmount: 0,
      undecidedNurseDays: 1,
    });
  });

  it("never nets excess from one bucket against shortages in another", () => {
    const report = composeStaffingReport({
      period: { start: first, end: first },
      nursingRosterIds: ["a", "b", "c"],
      assignments: ["a", "b", "c"].map((id) => assignment(id, "2026-10-31", "N")),
      requirements,
    });
    expect(report.totals).toMatchObject({
      affectedShortageDays: 1, shortageBuckets: 2, shortageAmount: 3,
      affectedExcessDays: 1, excessBuckets: 1, excessAmount: 3,
    });
  });

  it("keeps unlimited maxima and zero minima, and carries independently resolved origins", () => {
    const report = composeStaffingReport({
      period: { start: second, end: second },
      nursingRosterIds: ["a"],
      assignments: [assignment("a", "2026-11-01", "M")],
      requirements,
      origins: new Map([[second, { M: "HOLIDAY" as const, E: "DATE_EXCEPTION" as const }]]),
    });
    expect(report.days[0].buckets[0]).toMatchObject({
      covered: 1, status: "WITHIN_BOUNDS", shortage: 0, excess: 0, origin: "HOLIDAY",
    });
    expect(report.days[0].buckets[1]).toMatchObject({
      covered: 0, status: "BELOW_MINIMUM", shortage: 1, origin: "DATE_EXCEPTION",
    });
  });

  it("distinguishes empty nursing roster from unavailable staffing bounds", () => {
    const report = composeStaffingReport({
      period: { start: first, end: first },
      nursingRosterIds: [],
      assignments: [assignment("secretary", "2026-10-31", "ME")],
      requirements: new Map(),
    });
    expect(report.days[0].undecidedNurses).toBe(0);
    expect(report.days[0].buckets.every((bucket) => bucket.status === "NOT_CONFIGURED")).toBe(true);
  });

  it("rejects duplicate decisions, duplicate roster entries and malformed periods", () => {
    const input = {
      period: { start: first, end: first },
      nursingRosterIds: ["a"],
      assignments: [assignment("a", "2026-10-31", "M"), assignment("a", "2026-10-31", "E")],
      requirements,
    };
    expect(() => composeStaffingReport(input)).toThrow("Duplicate nurse-day assignment");
    expect(() => composeStaffingReport({ ...input, nursingRosterIds: ["a", "a"], assignments: [] })).toThrow("Invalid nursing roster");
    expect(() => composeStaffingReport({ ...input, period: { start: second, end: first }, assignments: [] })).toThrow();
  });
});
