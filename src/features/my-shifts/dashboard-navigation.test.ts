import { expect, it } from "vitest";

import { addDays, isoDate } from "@/domain/shared/dates";
import {
  parseCalendarView,
  weekPeriod,
  weekStart,
  weeklyHref,
} from "./dashboard-navigation";

const today = isoDate("2026-10-20");
it("defaults to today plus six days and navigates exactly seven days across months", () => {
  const period = weekPeriod(today);
  expect(period).toEqual({ start: today, end: "2026-10-26" });
  expect(weekPeriod(addDays(period.start, 7))).toEqual({
    start: "2026-10-27",
    end: "2026-11-02",
  });
  expect(addDays(addDays(today, 7), -7)).toBe(today);
  expect(weeklyHref(today, period.end)).toBe(
    "/my-shifts?view=week&start=2026-10-20&day=2026-10-26",
  );
  expect(weeklyHref(today)).toBe("/my-shifts?view=week&start=2026-10-20");
});
it("validates view preferences and ignores malformed or unsupported dates", () => {
  expect(parseCalendarView("month")).toBe("month");
  expect(parseCalendarView("week")).toBe("week");
  for (const value of [null, undefined, "year", ["week"]])
    expect(parseCalendarView(value)).toBeNull();
  expect(weekStart(today, isoDate("2026-01-01"))).toBe(today);
  for (const value of [
    "2026-02-30",
    "0001-01-01",
    "9999-12-31",
    [today],
    undefined,
  ])
    expect(weekStart(value, today)).toBe(today);
});
