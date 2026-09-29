import { describe, expect, it } from "vitest";

import { eachDay, isoDate, type DayOfWeek } from "../shared/dates";
import { ValidationError } from "../shared/errors";
import {
  expandDateScope,
  scopeIncludes,
  type DateScopeInput,
} from "./date-scope";

// Farvardin 1405: Sat 2026-03-21 .. Mon 2026-04-20
const period = { start: isoDate("2026-03-21"), end: isoDate("2026-04-20") };

const dates = (input: DateScopeInput, weekStartsOn?: DayOfWeek) => {
  const result = expandDateScope(input, period, weekStartsOn);
  if (!result.ok) throw result.error;
  return result.value.dates;
};

describe("expandDateScope: valid scopes", () => {
  it.each<[string, DateScopeInput, string[]]>([
    ["one day", { kind: "DAY", date: "2026-04-18" }, ["2026-04-18"]],
    [
      "several days (sorted, de-duplicated)",
      { kind: "DAYS", dates: ["2026-04-19", "2026-04-18", "2026-04-19"] },
      ["2026-04-18", "2026-04-19"],
    ],
    [
      "a range",
      { kind: "RANGE", from: "2026-04-17", to: "2026-04-19" },
      ["2026-04-17", "2026-04-18", "2026-04-19"],
    ],
    [
      "a one-day range",
      { kind: "RANGE", from: "2026-04-17", to: "2026-04-17" },
      ["2026-04-17"],
    ],
    [
      "a full week (Saturday to Friday)",
      { kind: "WEEK", anyDateInWeek: "2026-04-01" },
      eachDay(isoDate("2026-03-28"), isoDate("2026-04-03")),
    ],
    [
      "the last week, clipped to the period",
      { kind: "WEEK", anyDateInWeek: "2026-04-20" },
      ["2026-04-18", "2026-04-19", "2026-04-20"],
    ],
    [
      "the first week (period starts on Saturday)",
      { kind: "WEEK", anyDateInWeek: "2026-03-27" },
      eachDay(isoDate("2026-03-21"), isoDate("2026-03-27")),
    ],
  ])("%s", (_, input, expected) => {
    expect(dates(input)).toEqual(expected);
  });

  it("expands the whole period", () => {
    const all = dates({ kind: "PERIOD" });
    expect(all).toHaveLength(31);
    expect([all[0], all.at(-1)]).toEqual(["2026-03-21", "2026-04-20"]);
  });

  it("honours a different week start", () => {
    // Monday-start week containing Wed 2026-04-01
    expect(dates({ kind: "WEEK", anyDateInWeek: "2026-04-01" }, 1)).toEqual(
      eachDay(isoDate("2026-03-30"), isoDate("2026-04-05")),
    );
  });

  it("clips a week that starts before the period", () => {
    const monthPeriod = {
      start: isoDate("2026-04-21"),
      end: isoDate("2026-05-21"),
    }; // starts Tuesday
    const result = expandDateScope(
      { kind: "WEEK", anyDateInWeek: "2026-04-22" },
      monthPeriod,
    );
    expect(result.ok && result.value.dates).toEqual(
      eachDay(isoDate("2026-04-21"), isoDate("2026-04-24")),
    );
  });

  it("keeps the scope kind for display", () => {
    const result = expandDateScope(
      { kind: "WEEK", anyDateInWeek: "2026-04-01" },
      period,
    );
    expect(result.ok && result.value.kind).toBe("WEEK");
  });
});

describe("expandDateScope: rejected scopes", () => {
  it.each<[string, DateScopeInput, string]>([
    ["an invalid day", { kind: "DAY", date: "2026-02-30" }, "date"],
    ["a day outside the period", { kind: "DAY", date: "2026-04-21" }, "date"],
    ["no days", { kind: "DAYS", dates: [] }, "dates"],
    [
      "a day list with an outside date",
      { kind: "DAYS", dates: ["2026-04-18", "2026-05-01"] },
      "dates",
    ],
    [
      "a day list with a malformed date",
      { kind: "DAYS", dates: ["18/04/2026"] },
      "dates",
    ],
    [
      "a range starting outside",
      { kind: "RANGE", from: "2026-03-20", to: "2026-03-22" },
      "from",
    ],
    [
      "a range ending outside",
      { kind: "RANGE", from: "2026-04-19", to: "2026-04-22" },
      "to",
    ],
    [
      "a reversed range",
      { kind: "RANGE", from: "2026-04-19", to: "2026-04-17" },
      "to",
    ],
    [
      "a week anchored outside",
      { kind: "WEEK", anyDateInWeek: "2026-04-22" },
      "anyDateInWeek",
    ],
  ])("%s", (_, input, field) => {
    const result = expandDateScope(input, period);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(ValidationError);
      expect(result.error.field).toBe(field);
    }
  });
});

describe("scopeIncludes", () => {
  it("checks membership", () => {
    const scope = { kind: "DAYS" as const, dates: [isoDate("2026-04-18")] };
    expect(scopeIncludes(scope, isoDate("2026-04-18"))).toBe(true);
    expect(scopeIncludes(scope, isoDate("2026-04-19"))).toBe(false);
  });
});
