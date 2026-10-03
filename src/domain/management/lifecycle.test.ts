import { describe, expect, it } from "vitest";

import { isoDate } from "../shared/dates";
import {
  assertActiveAdminRemains,
  predecessorEnd,
  validateRelationDates,
  validateRelationEnd,
} from "./lifecycle";

const day = isoDate;
const today = day("2026-10-03");
const relation = { startedOn: day("2026-01-01"), endedOn: null };

describe("effective-dated relation lifecycle", () => {
  it.each([null, day("2026-01-01"), day("2026-12-31")])(
    "accepts a valid term (%s)",
    (endedOn) => {
      expect(() =>
        validateRelationDates({ ...relation, endedOn }),
      ).not.toThrow();
    },
  );
  it("rejects an inverted term", () => {
    expect(() =>
      validateRelationDates({ ...relation, endedOn: day("2025-12-31") }),
    ).toThrow("precedes");
  });
  it.each(["2026-10-03", "2026-12-31"])(
    "allows ending a current open term on %s",
    (endedOn) => {
      expect(() =>
        validateRelationEnd(relation, day(endedOn), today),
      ).not.toThrow();
    },
  );
  it("allows shortening or retaining a fixed term", () => {
    const fixed = { ...relation, endedOn: day("2026-12-31") };
    validateRelationEnd(fixed, today, today);
    validateRelationEnd(fixed, fixed.endedOn, today);
  });
  it.each([
    [{ startedOn: day("2026-10-04"), endedOn: null }, today],
    [{ ...relation, endedOn: day("2026-10-02") }, today],
    [relation, day("2026-10-02")],
    [{ ...relation, endedOn: day("2026-10-04") }, day("2026-10-05")],
  ] as const)(
    "rejects non-current, historical, or extending ends %#",
    (before, endedOn) => {
      expect(() => validateRelationEnd(before, endedOn, today)).toThrow();
    },
  );
  it("transitions today by ending yesterday", () => {
    expect(predecessorEnd(relation, today, today)).toBe("2026-10-02");
  });
  it("transitions in the future and at a fixed-term boundary", () => {
    expect(predecessorEnd(relation, day("2026-11-01"), today)).toBe(
      "2026-10-31",
    );
    expect(
      predecessorEnd({ ...relation, endedOn: today }, day("2026-10-04"), today),
    ).toBe(today);
  });
  it.each([
    [relation, day("2026-10-02")],
    [{ startedOn: today, endedOn: null }, today],
    [{ startedOn: day("2026-10-04"), endedOn: null }, day("2026-10-05")],
    [{ ...relation, endedOn: day("2026-10-02") }, today],
    [{ ...relation, endedOn: today }, day("2026-10-05")],
  ] as const)("refuses rewriting or extending history %#", (before, start) => {
    expect(() => predecessorEnd(before, start, today)).toThrow();
  });
});

describe("last active Hospital Admin", () => {
  it("refuses the last removal", () => {
    expect(() =>
      assertActiveAdminRemains({
        wasActiveAdmin: true,
        willBeActiveAdmin: false,
        activeAdminCount: 1,
      }),
    ).toThrow("last active");
  });
  it.each([
    { wasActiveAdmin: false, willBeActiveAdmin: false, activeAdminCount: 1 },
    { wasActiveAdmin: true, willBeActiveAdmin: true, activeAdminCount: 1 },
    { wasActiveAdmin: true, willBeActiveAdmin: false, activeAdminCount: 2 },
  ])("allows safe lifecycle changes %#", (input) => {
    expect(() => assertActiveAdminRemains(input)).not.toThrow();
  });
});
