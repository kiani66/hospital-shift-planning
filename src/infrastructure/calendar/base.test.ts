import { describe, expect, it } from "vitest";
import { addDays, dayOfWeek, isoDate } from "../../domain/shared/dates";
import { todayIn, APP_TIMEZONE } from "../auth/actor";
import {
  calendarHorizon,
  calendarYearPeriod,
  generateCalendarDays,
} from "./base";
import { toJalali } from "./jalali";

describe("official calendar base generation", () => {
  it.each([
    [1399, "2020-03-20", "2021-03-20", 366],
    [1400, "2021-03-21", "2022-03-20", 365],
    [1403, "2024-03-20", "2025-03-20", 366],
    [1404, "2025-03-21", "2026-03-20", 365],
    [1405, "2026-03-21", "2027-03-20", 365],
  ])(
    "maps Jalali year %i including its leap boundary",
    (year, start, end, length) => {
      expect(calendarYearPeriod(year)).toEqual({ start, end });
      const days = generateCalendarDays(year);
      expect(days).toHaveLength(length);
      expect(days[0]!.date).toBe(start);
      expect(days.at(-1)!.date).toBe(end);
      expect(toJalali(days[0]!.date)).toEqual({ year, month: 1, day: 1 });
      expect(toJalali(days.at(-1)!.date)).toEqual({
        year,
        month: 12,
        day: length === 366 ? 30 : 29,
      });
      for (const [i, day] of days.entries()) {
        expect(day.date).toBe(addDays(isoDate(start), i));
        expect(toJalali(day.date).year).toBe(year);
        expect(day.isFriday).toBe(dayOfWeek(day.date) === 5);
        expect(day.officialStatus).toBe("UNKNOWN");
        expect(day.holidayNames).toEqual([]);
      }
      expect(toJalali(addDays(days.at(-1)!.date, 1))).toEqual({
        year: year + 1,
        month: 1,
        day: 1,
      });
    },
  );

  it("uses the Tehran day and rolls the horizon over at Nowruz", () => {
    const before = todayIn(APP_TIMEZONE, new Date("2026-03-20T20:29:59Z"));
    const after = todayIn(APP_TIMEZONE, new Date("2026-03-20T20:30:00Z"));
    expect(calendarHorizon(before)).toEqual(
      Array.from({ length: 10 }, (_, i) => 1399 + i),
    );
    expect(calendarHorizon(after)).toEqual(
      Array.from({ length: 10 }, (_, i) => 1400 + i),
    );
    const current = toJalali(todayIn(APP_TIMEZONE)).year;
    expect(calendarHorizon(todayIn(APP_TIMEZONE))).toEqual(
      Array.from({ length: 10 }, (_, i) => current - 5 + i),
    );
  });

  it.each([1299, 1501, 1405.5, NaN])("rejects unsupported year %s", (year) => {
    expect(() => generateCalendarDays(year)).toThrow("Unsupported Jalali");
  });
});
