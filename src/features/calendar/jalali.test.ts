import { describe, expect, it } from "vitest";

import { isoDate } from "@/domain/shared/dates";
import { createPeriod } from "@/domain/shared/period";
import { APP_TIMEZONE, todayIn } from "@/infrastructure/auth/actor";

import {
  formatJalaliDate,
  formatJalaliDateTime,
  formatJalaliRange,
  isJalaliMonth,
  jalaliMonthLabel,
  jalaliMonthOptions,
  jalaliMonthPeriod,
  jalaliWeekday,
  toJalali,
  wholeJalaliMonthOf,
} from "./jalali";

const d = isoDate;

describe("jalaliMonthPeriod: ISO boundaries of whole Jalali months", () => {
  // Reference boundaries from the official Iranian calendar.
  it.each([
    [1405, 1, "2026-03-21", "2026-04-20", 31],
    [1405, 6, "2026-08-23", "2026-09-22", 31],
    [1405, 7, "2026-09-23", "2026-10-22", 30],
    [1405, 8, "2026-10-23", "2026-11-21", 30],
    [1405, 9, "2026-11-22", "2026-12-21", 30],
    // Crosses the Gregorian new year.
    [1405, 10, "2026-12-22", "2027-01-20", 30],
    // Esfand of a leap year (1403) has 30 days, of a common year (1404) 29.
    [1403, 12, "2025-02-19", "2025-03-20", 30],
    [1404, 12, "2026-02-20", "2026-03-20", 29],
    // Crosses into the next Jalali year.
    [1404, 1, "2025-03-21", "2025-04-20", 31],
  ])("%i/%i → %s..%s (%i days)", (year, month, start, end, days) => {
    const period = jalaliMonthPeriod({ year, month });
    expect(period).toEqual({ start, end });
    const domain = createPeriod(period.start, period.end);
    expect(domain.ok && domain.value).toEqual({ start, end });
    expect(toJalali(d(start))).toEqual({ year, month, day: 1 });
    expect(toJalali(d(end))).toMatchObject({ year, month, day: days });
  });

  it("chains months without gaps or overlaps across two years", () => {
    let previousEnd: string | null = null;
    for (const year of [1404, 1405, 1406])
      for (let month = 1; month <= 12; month++) {
        const { start, end } = jalaliMonthPeriod({ year, month });
        if (previousEnd) expect(start > previousEnd).toBe(true);
        previousEnd = end;
      }
  });

  it.each([
    { year: 1405, month: 0 },
    { year: 1405, month: 13 },
    { year: 1405.5, month: 1 },
    { year: 1200, month: 1 },
  ])("rejects %o", (month) => {
    expect(isJalaliMonth(month)).toBe(false);
    expect(() => jalaliMonthPeriod(month)).toThrow(RangeError);
  });
});

describe("Persian labels", () => {
  it("names the month in Persian with Persian digits", () => {
    expect(jalaliMonthLabel({ year: 1405, month: 7 })).toBe("مهر ۱۴۰۵");
    expect(jalaliMonthLabel({ year: 1405, month: 8 })).toBe("آبان ۱۴۰۵");
    expect(jalaliMonthLabel({ year: 1405, month: 9 })).toBe("آذر ۱۴۰۵");
  });

  it("formats dates, weekdays and ranges without Gregorian parts", () => {
    expect(formatJalaliDate(d("2026-10-23"))).toBe("۱ آبان ۱۴۰۵");
    expect(formatJalaliDate(d("2026-10-23"), { weekday: true })).toBe(
      "جمعه ۱ آبان ۱۴۰۵",
    );
    // The week starts on Saturday: 2 Aban 1405 is a Saturday.
    expect(formatJalaliDate(d("2026-10-24"), { weekday: true })).toBe(
      "شنبه ۲ آبان ۱۴۰۵",
    );
    expect(jalaliWeekday(d("2026-10-24"))).toBe("شنبه");
    expect(jalaliWeekday(d("2026-10-30"))).toBe("جمعه");
    expect(formatJalaliRange(d("2026-10-23"), d("2026-11-21"))).toBe(
      "۱ تا ۳۰ آبان ۱۴۰۵",
    );
    expect(formatJalaliRange(d("2026-10-23"), d("2026-11-22"))).toBe(
      "۱ آبان ۱۴۰۵ تا ۱ آذر ۱۴۰۵",
    );
  });

  it("recognises whole-month periods only", () => {
    expect(
      wholeJalaliMonthOf({ start: d("2026-10-23"), end: d("2026-11-21") }),
    ).toEqual({ year: 1405, month: 8 });
    expect(
      wholeJalaliMonthOf({ start: d("2026-10-23"), end: d("2026-11-20") }),
    ).toBeNull();
    expect(
      wholeJalaliMonthOf({ start: d("2026-10-24"), end: d("2026-11-21") }),
    ).toBeNull();
  });

  it("shows instants in Tehran time", () => {
    // 20:45 UTC on 22 Oct is 00:15 on 1 Aban in Tehran (UTC+03:30).
    const text = formatJalaliDateTime(
      new Date("2026-10-22T20:45:00Z"),
      APP_TIMEZONE,
    );
    expect(text).toContain("آبان");
    expect(text).toContain("۰۰:۱۵");
  });
});

describe("jalaliMonthOptions", () => {
  it("offers the current and next Jalali year and suggests the next month", () => {
    const { years, options, suggested } = jalaliMonthOptions(
      d("2026-09-29"),
      [],
    );
    expect(years).toEqual([1405, 1406]);
    expect(options).toHaveLength(24);
    expect(suggested).toEqual({ year: 1405, month: 8 });
    expect(options[7]).toMatchObject({
      label: "آبان ۱۴۰۵",
      startLabel: "جمعه ۱ آبان ۱۴۰۵",
      endLabel: "شنبه ۳۰ آبان ۱۴۰۵",
      dayCount: 30,
      taken: false,
    });
  });

  it("marks months overlapping an existing schedule and skips them in the suggestion", () => {
    const { options, suggested } = jalaliMonthOptions(d("2026-09-29"), [
      { start: d("2026-10-23"), end: d("2026-11-21") },
    ]);
    expect(options.filter((o) => o.taken).map((o) => o.label)).toEqual([
      "آبان ۱۴۰۵",
    ]);
    expect(suggested).toEqual({ year: 1405, month: 9 });
  });

  it("uses Tehran's day near midnight, not UTC's", () => {
    // 21:00 UTC on 22 Sep is 00:30 on 23 Sep in Tehran: already 1 Mehr 1405.
    const instant = new Date("2026-09-22T21:00:00Z");
    expect(todayIn("UTC", instant)).toBe("2026-09-22");
    const today = todayIn(APP_TIMEZONE, instant);
    expect(today).toBe("2026-09-23");
    expect(toJalali(today)).toEqual({ year: 1405, month: 7, day: 1 });
    expect(jalaliMonthOptions(today, []).suggested).toEqual({
      year: 1405,
      month: 8,
    });
    // By UTC it would still be Shahrivar, suggesting Mehr.
    expect(jalaliMonthOptions(todayIn("UTC", instant), []).suggested).toEqual({
      year: 1405,
      month: 7,
    });
  });

  it("rolls the suggestion over into the next Jalali year in Esfand", () => {
    const { years, suggested } = jalaliMonthOptions(d("2027-03-01"), []);
    expect(years).toEqual([1405, 1406]);
    expect(suggested).toEqual({ year: 1406, month: 1 });
  });
});
