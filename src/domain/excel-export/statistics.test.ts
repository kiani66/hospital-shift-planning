import { describe, expect, it } from "vitest";

import type { AssignmentCode } from "../shifts/shift-type";
import { dailyStatistic, personStatistic } from "./statistics";

const month = (codes: readonly (AssignmentCode | null)[]) =>
  new Map(
    codes.flatMap((code, i) => (code === null ? [] : [[i + 1, code] as const])),
  );

describe("personStatistic", () => {
  // 30 days: 3 M, 1 E, 2 N, 1 ME, 2 H, the rest OFF.
  const complete = month([
    "M",
    "M",
    "M",
    "E",
    "N",
    "OFF",
    "N",
    "OFF",
    "ME",
    "H",
    "H",
    ...Array<AssignmentCode>(19).fill("OFF"),
  ]);

  it("counts working shifts (ME once) and leave days apart", () => {
    expect(personStatistic("SHIFT_COUNT", 30, complete)).toBe(7);
    expect(personStatistic("LEAVE_DAYS", 30, complete)).toBe(2);
  });

  it("ignores decisions past the period", () => {
    const withExtra = new Map(complete).set(31, "N");
    expect(personStatistic("SHIFT_COUNT", 30, withExtra)).toBe(7);
  });

  it("is ? while any day of the period is undecided, never a partial count", () => {
    const partial = new Map(complete);
    partial.delete(20);
    expect(personStatistic("SHIFT_COUNT", 30, partial)).toBe("?");
    expect(personStatistic("LEAVE_DAYS", 30, partial)).toBe("?");
  });

  it("clears what the system cannot calculate", () => {
    expect(personStatistic("CLEAR", 30, complete)).toBeNull();
    expect(personStatistic("CLEAR", 30, new Map())).toBeNull();
  });

  it("an all-rest month counts zero", () => {
    const rest = month(Array<AssignmentCode>(29).fill("OFF"));
    expect(personStatistic("SHIFT_COUNT", 29, rest)).toBe(0);
    expect(personStatistic("LEAVE_DAYS", 29, rest)).toBe(0);
  });
});

describe("dailyStatistic", () => {
  const a = month(["M", "ME", "N", "OFF", "H"]);
  const b = month(["E", "M", "N", "N", null]);

  it("counts nursing coverage per period as staffing does (ME toward M and E)", () => {
    const m = dailyStatistic("COVERAGE_M", 5, [a, b]);
    const e = dailyStatistic("COVERAGE_E", 5, [a, b]);
    const n = dailyStatistic("COVERAGE_N", 5, [a, b]);
    expect(m.slice(0, 4)).toEqual([1, 2, 0, 0]);
    expect(e.slice(0, 4)).toEqual([1, 1, 0, 0]);
    expect(n.slice(0, 4)).toEqual([0, 0, 2, 1]);
  });

  it("is ? on a day someone counted is undecided, blank past the period", () => {
    const values = dailyStatistic("COVERAGE_M", 5, [a, b]);
    expect(values).toHaveLength(31);
    expect(values[4]).toBe("?");
    expect(values.slice(5).every((v) => v === null)).toBe(true);
  });

  it("clears every day for CLEAR and counts zero with nobody counted", () => {
    expect(dailyStatistic("CLEAR", 5, [a, b]).every((v) => v === null)).toBe(
      true,
    );
    expect(dailyStatistic("COVERAGE_N", 2, []).slice(0, 2)).toEqual([0, 0]);
  });
});
