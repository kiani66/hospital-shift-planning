import { describe, expect, it } from "vitest";

import { bounds, content } from "../../../tests/support/staffing-rules";
import { isoDate } from "../shared/dates";
import { resolveDay, resolveRequirements, toStaffingBounds } from "./resolve";

const d = isoDate;
const rules = content({
  normal: { M: bounds(3, 6), E: bounds(3, 6), N: bounds(3, 6) },
  holiday: { M: bounds(2, 4) },
  exceptions: [
    { date: d("2026-11-01"), period: "M", bounds: bounds(5, 7), note: null },
    { date: d("2026-11-02"), period: "N", bounds: bounds(4, null), note: "x" },
  ],
});

describe("resolveDay (Exception > Day Type > Normal, D106)", () => {
  it("uses NORMAL bounds on a normal day", () => {
    expect(resolveDay(rules, d("2026-11-03"), false)).toEqual({
      M: { min: 3, max: 6, source: "NORMAL" },
      E: { min: 3, max: 6, source: "NORMAL" },
      N: { min: 3, max: 6, source: "NORMAL" },
    });
  });

  it("uses HOLIDAY bounds on a holiday only for buckets that define them", () => {
    const day = resolveDay(rules, d("2026-11-03"), true);
    expect(day.M).toEqual({ min: 2, max: 4, source: "HOLIDAY" });
    expect(day.E).toEqual({ min: 3, max: 6, source: "NORMAL" });
  });

  it("lets a date exception win over the holiday and normal bounds", () => {
    const holiday = resolveDay(rules, d("2026-11-01"), true);
    expect(holiday.M).toEqual({ min: 5, max: 7, source: "EXCEPTION" });
    expect(resolveDay(rules, d("2026-11-01"), false).M.source).toBe(
      "EXCEPTION",
    );
    // An exception for one bucket leaves the others alone.
    expect(holiday.N.source).toBe("NORMAL");
    expect(resolveDay(rules, d("2026-11-02"), false).N).toEqual({
      min: 4,
      max: null,
      source: "EXCEPTION",
    });
  });
});

describe("resolveRequirements", () => {
  it("gives every day every bucket, as the validator consumes it", () => {
    const requirements = resolveRequirements(
      rules,
      [d("2026-11-01"), d("2026-11-02"), d("2026-11-03")],
      new Set([d("2026-11-03")]),
    );
    expect(requirements.get(d("2026-11-01"))).toEqual({
      M: { min: 5, max: 7 },
      E: { min: 3, max: 6 },
      N: { min: 3, max: 6 },
    });
    // An empty maximum is simply not set.
    expect(requirements.get(d("2026-11-02"))?.N).toEqual({ min: 4 });
    expect(requirements.get(d("2026-11-03"))?.M).toEqual({ min: 2, max: 4 });
  });

  it("toStaffingBounds keeps a set maximum and drops an empty one", () => {
    expect(toStaffingBounds(bounds(1))).toEqual({ min: 1 });
    expect(toStaffingBounds(bounds(1, 2))).toEqual({ min: 1, max: 2 });
  });
});
