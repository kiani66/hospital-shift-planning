import { expect, it } from "vitest";
import { jalaliMonthPeriod } from "./jalali";
import { periodDays } from "@/domain/shared/period";

it.each([
  [1405, 12, 29],
  [1405, 7, 30],
  [1405, 1, 31],
  [1403, 12, 30],
])(
  "uses the true %i/%i period with %i days for monthly import",
  (year, month, days) => {
    expect(
      periodDays(jalaliMonthPeriod({ year: year!, month: month! })),
    ).toHaveLength(days!);
  },
);
it("retains Mehr 1405 original ISO dates and earlier historical months", () => {
  expect(jalaliMonthPeriod({ year: 1405, month: 7 })).toEqual({
    start: "2026-09-23",
    end: "2026-10-22",
  });
  expect(jalaliMonthPeriod({ year: 1405, month: 1 })).toEqual({
    start: "2026-03-21",
    end: "2026-04-20",
  });
});
