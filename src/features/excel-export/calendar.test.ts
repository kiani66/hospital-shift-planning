import { describe, expect, it } from "vitest";

import { addDays, isoDate } from "@/domain/shared/dates";
import { jalaliMonthPeriod } from "@/features/calendar/jalali";

import { exportMonthHeading, jalaliExportCalendar } from "./calendar";

describe("jalaliExportCalendar", () => {
  it("heads a whole month as the hospital sheets do", () => {
    // «مهرماه 1405» with a zero-width non-joiner, which renders identically.
    expect(
      exportMonthHeading(jalaliMonthPeriod({ year: 1405, month: 7 })),
    ).toBe("مهر‌ماه 1405");
    expect(
      exportMonthHeading(jalaliMonthPeriod({ year: 1405, month: 12 })),
    ).toBe("اسفند‌ماه 1405");
    expect(
      exportMonthHeading({
        start: isoDate("2026-10-08"),
        end: isoDate("2026-11-06"),
      }),
    ).toBe("مهر‌ماه 1405 تا آبان‌ماه 1405");
  });

  it("does not depend on the server's timezone", () => {
    const zone = process.env.TZ;
    const date = isoDate("2026-10-23"); // Friday 1 Aban 1405.
    try {
      for (const tz of ["Pacific/Kiritimati", "America/Los_Angeles", "UTC"]) {
        process.env.TZ = tz;
        expect(jalaliExportCalendar.dayNumber(date), tz).toBe(1);
        expect(jalaliExportCalendar.weekday(date, "NARROW"), tz).toBe("ج");
        expect(
          exportMonthHeading(jalaliMonthPeriod({ year: 1405, month: 8 })),
          tz,
        ).toBe("آبان‌ماه 1405");
      }
    } finally {
      process.env.TZ = zone;
    }
  });

  it.each([
    // [month, length, weekday of day 1]
    [{ year: 1405, month: 6 }, 31, "یکشنبه"],
    [{ year: 1405, month: 7 }, 30, "چهارشنبه"],
    [{ year: 1405, month: 12 }, 29, "شنبه"],
  ] as const)("numbers and names the days of %j", (month, length, first) => {
    const { start, end } = jalaliMonthPeriod(month);
    const dates = Array.from({ length }, (_, i) => addDays(start, i));
    expect(dates.at(-1)).toBe(end);
    expect(dates.map(jalaliExportCalendar.dayNumber)).toEqual(
      Array.from({ length }, (_, i) => i + 1),
    );
    expect(jalaliExportCalendar.weekday(start, "LONG")).toBe(first);
    expect(jalaliExportCalendar.weekday(start, "NARROW")).toBe(first[0]);
  });
});
