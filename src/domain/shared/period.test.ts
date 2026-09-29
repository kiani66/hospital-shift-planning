import { describe, expect, it } from "vitest";

import { isoDate } from "./dates";
import {
  createPeriod,
  isInPeriod,
  MAX_PERIOD_DAYS,
  periodDays,
} from "./period";

const d = isoDate;

describe("createPeriod", () => {
  it("accepts a Jalali month expressed as Gregorian dates (Farvardin 1405)", () => {
    const result = createPeriod("2026-03-21", "2026-04-20");
    expect(result).toEqual({
      ok: true,
      value: { start: "2026-03-21", end: "2026-04-20" },
    });
  });

  it("accepts a single-day period", () => {
    expect(createPeriod("2026-03-21", "2026-03-21").ok).toBe(true);
  });

  it.each([
    ["bad start", "2026-02-30", "2026-03-10", "periodStart"],
    ["bad end", "2026-03-01", "2026-03-32", "periodEnd"],
    ["end before start", "2026-03-10", "2026-03-09", "periodEnd"],
    ["too long", "2026-01-01", "2026-03-04", "periodEnd"],
  ])("rejects %s", (_, start, end, field) => {
    const result = createPeriod(start, end);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.field).toBe(field);
  });

  it(`allows exactly ${MAX_PERIOD_DAYS} days`, () => {
    expect(createPeriod("2026-01-01", "2026-03-03").ok).toBe(true);
  });
});

describe("isInPeriod / periodDays", () => {
  const period = { start: d("2026-03-21"), end: d("2026-04-20") };

  it.each([
    ["2026-03-20", false],
    ["2026-03-21", true],
    ["2026-04-01", true],
    ["2026-04-20", true],
    ["2026-04-21", false],
  ])("isInPeriod(%s) = %s", (date, expected) => {
    expect(isInPeriod(period, d(date))).toBe(expected);
  });

  it("lists all 31 days of Farvardin", () => {
    const days = periodDays(period);
    expect(days).toHaveLength(31);
    expect(days[0]).toBe("2026-03-21");
    expect(days.at(-1)).toBe("2026-04-20");
  });
});
