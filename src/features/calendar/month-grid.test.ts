import { describe, expect, it } from "vitest";

import { dayOfWeek, isoDate, SATURDAY } from "@/domain/shared/dates";

import { jalaliMonthPeriod } from "./jalali";
import { monthGrid } from "./month-grid";

const gridOf = (year: number, month: number) => {
  const period = jalaliMonthPeriod({ year, month });
  return { period, grid: monthGrid(period, [{ date: period.start, n: 1 }]) };
};

describe("monthGrid", () => {
  it("has Saturday-first weekday headers", () => {
    const { grid } = gridOf(1405, 8);
    expect(grid.weekdays.map((w) => w.long)).toEqual([
      "شنبه",
      "یکشنبه",
      "دوشنبه",
      "سه‌شنبه",
      "چهارشنبه",
      "پنجشنبه",
      "جمعه",
    ]);
    expect(grid.weekdays.map((w) => w.short)).toEqual([
      "ش",
      "ی",
      "د",
      "س",
      "چ",
      "پ",
      "ج",
    ]);
  });

  it("uses as many rows as the month needs (5 or 6), each of 7 days", () => {
    // Aban 1405 starts on a Friday: 1 + 29 days spill into a sixth week.
    const aban = gridOf(1405, 8).grid;
    expect(aban.weeks).toHaveLength(6);
    // Azar 1405 starts on a Sunday: 30 days fit in five weeks.
    const azar = gridOf(1405, 9).grid;
    expect(azar.weeks).toHaveLength(5);
    for (const week of [...aban.weeks, ...azar.weeks]) {
      expect(week).toHaveLength(7);
      expect(dayOfWeek(week[0]!.date)).toBe(SATURDAY);
    }
  });

  it("marks only the period's days as in-period and attaches their data", () => {
    const { period, grid } = gridOf(1405, 8);
    const cells = grid.weeks.flat();
    const inPeriod = cells.filter((c) => c.inPeriod);
    expect(inPeriod).toHaveLength(30);
    expect(inPeriod[0]!.date).toBe(period.start);
    expect(inPeriod.at(-1)!.date).toBe(period.end);
    expect(inPeriod[0]).toMatchObject({ dayNumber: "۱", data: { n: 1 } });
    expect(inPeriod[1]!.data).toBeNull();
    // Leading days belong to Mehr and carry no data.
    expect(cells[0]).toMatchObject({ inPeriod: false, data: null });
    expect(cells[0]!.dayNumber).toBe("۲۵");
  });

  it("lays out any period, not only whole months", () => {
    const grid = monthGrid(
      { start: isoDate("2026-10-24"), end: isoDate("2026-10-24") },
      [],
    );
    expect(grid.weeks).toHaveLength(1);
    expect(grid.weeks[0]!.filter((c) => c.inPeriod)).toHaveLength(1);
  });
});
