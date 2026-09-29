import { describe, expect, it } from "vitest";

import {
  addDays,
  compareIsoDates,
  dayOfWeek,
  daysBetween,
  eachDay,
  isIsoDate,
  isoDate,
  parseIsoDate,
  SATURDAY,
  startOfWeek,
  uniqueSortedDates,
  type DayOfWeek,
} from "./dates";
import { ValidationError } from "./errors";

const d = isoDate;

describe("isIsoDate", () => {
  it.each([
    ["2026-03-21", true],
    ["2024-02-29", true], // leap year
    ["2000-02-29", true], // divisible by 400
    ["2026-04-30", true],
    ["2026-12-31", true],
    ["0001-01-01", true],
    ["2026-02-29", false], // not a leap year
    ["1900-02-29", false], // divisible by 100, not 400
    ["2026-04-31", false],
    ["2026-13-01", false],
    ["2026-00-10", false],
    ["2026-01-00", false],
    ["0000-01-01", false],
    ["2026-1-01", false],
    ["2026/01/01", false],
    ["20260101", false],
    [" 2026-01-01", false],
    ["", false],
  ])("%j → %s", (value, expected) => {
    expect(isIsoDate(value)).toBe(expected);
  });

  it.each([null, undefined, 20260101, {}, new Date()])(
    "rejects non-string %j",
    (value) => {
      expect(isIsoDate(value)).toBe(false);
    },
  );
});

describe("parseIsoDate / isoDate", () => {
  it("returns the branded value when valid", () => {
    expect(parseIsoDate("2026-03-21")).toEqual({
      ok: true,
      value: "2026-03-21",
    });
  });

  it("returns a ValidationError naming the field when invalid", () => {
    const result = parseIsoDate("2026-02-30", "periodStart");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(ValidationError);
      expect(result.error.field).toBe("periodStart");
    }
  });

  it("defaults the field name to 'date'", () => {
    const result = parseIsoDate("nope");
    expect(!result.ok && result.error.field).toBe("date");
  });

  it("isoDate throws on invalid literals", () => {
    expect(() => isoDate("2026-02-30")).toThrow(ValidationError);
    expect(isoDate("2026-02-28")).toBe("2026-02-28");
  });
});

describe("addDays / daysBetween", () => {
  it.each([
    ["2026-03-21", 1, "2026-03-22"],
    ["2026-03-31", 1, "2026-04-01"], // month end
    ["2026-12-31", 1, "2027-01-01"], // year end
    ["2024-02-28", 1, "2024-02-29"], // leap day
    ["2024-02-29", 1, "2024-03-01"],
    ["2026-02-28", 1, "2026-03-01"],
    ["2026-03-01", -1, "2026-02-28"],
    ["2026-01-01", -1, "2025-12-31"],
    ["2026-03-21", 0, "2026-03-21"],
    ["2026-03-21", 365, "2027-03-21"],
    ["1970-01-01", -1, "1969-12-31"], // before the epoch
    ["0001-01-01", 1, "0001-01-02"],
  ])("%s %+d days = %s", (from, n, expected) => {
    expect(addDays(d(from), n)).toBe(expected);
    expect(daysBetween(d(from), d(expected))).toBe(n);
  });

  it("agrees with the UTC calendar for every day over several years", () => {
    // Oracle check against JS Date (UTC) across leap and century boundaries.
    let date = d("1999-12-25");
    let utc = Date.UTC(1999, 11, 25);
    for (let i = 0; i < 365 * 4 + 10; i++) {
      expect(date).toBe(new Date(utc).toISOString().slice(0, 10));
      expect(dayOfWeek(date)).toBe(new Date(utc).getUTCDay());
      date = addDays(date, 1);
      utc += 86_400_000;
    }
  });
});

describe("compareIsoDates", () => {
  it.each([
    ["2026-03-21", "2026-03-22", -1],
    ["2026-03-22", "2026-03-21", 1],
    ["2026-03-21", "2026-03-21", 0],
    ["2025-12-31", "2026-01-01", -1],
  ])("compare(%s, %s) = %d", (a, b, expected) => {
    expect(compareIsoDates(d(a), d(b))).toBe(expected);
  });
});

describe("dayOfWeek / startOfWeek", () => {
  it.each([
    ["2026-03-21", 6], // Saturday: 1 Farvardin 1405
    ["2026-03-22", 0],
    ["2026-03-27", 5], // Friday
    ["1970-01-01", 4],
    ["1969-12-31", 3],
  ])("dayOfWeek(%s) = %d", (date, expected) => {
    expect(dayOfWeek(d(date))).toBe(expected);
  });

  it("uses Saturday as the default week start", () => {
    expect(SATURDAY).toBe(6);
  });

  it.each([
    ["2026-03-21", SATURDAY, "2026-03-21"], // Saturday itself
    ["2026-03-27", SATURDAY, "2026-03-21"], // Friday → previous Saturday
    ["2026-03-22", SATURDAY, "2026-03-21"],
    ["2026-03-28", SATURDAY, "2026-03-28"],
    ["2026-03-25", 1, "2026-03-23"], // Monday-start week
    ["2026-03-22", 0, "2026-03-22"], // Sunday-start week
  ] as const)("startOfWeek(%s, %d) = %s", (date, weekStartsOn, expected) => {
    expect(startOfWeek(d(date), weekStartsOn as DayOfWeek)).toBe(expected);
  });

  it("startOfWeek defaults to Saturday", () => {
    expect(startOfWeek(d("2026-03-26"))).toBe("2026-03-21");
  });
});

describe("eachDay / uniqueSortedDates", () => {
  it("lists every day inclusively", () => {
    expect(eachDay(d("2026-02-27"), d("2026-03-02"))).toEqual([
      "2026-02-27",
      "2026-02-28",
      "2026-03-01",
      "2026-03-02",
    ]);
  });

  it("returns a single day when from = to", () => {
    expect(eachDay(d("2026-03-21"), d("2026-03-21"))).toEqual(["2026-03-21"]);
  });

  it("returns nothing when to is before from", () => {
    expect(eachDay(d("2026-03-22"), d("2026-03-21"))).toEqual([]);
  });

  it("sorts and de-duplicates", () => {
    expect(
      uniqueSortedDates([d("2026-03-23"), d("2026-03-21"), d("2026-03-23")]),
    ).toEqual(["2026-03-21", "2026-03-23"]);
  });
});
