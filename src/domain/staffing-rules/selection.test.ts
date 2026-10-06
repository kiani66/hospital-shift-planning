import { describe, expect, it } from "vitest";

import { version } from "../../../tests/support/staffing-rules";
import { isoDate } from "../shared/dates";
import {
  effectiveState,
  NO_EFFECTIVE_RULE_SET,
  selectEffective,
  selectForSchedule,
} from "./selection";

const d = isoDate;

// Hospital Default: baseline v1, v2 from 1405-08-01 (2026-10-23), v3 scheduled for 2026-11-22.
const v1 = version("v1", { effectiveFrom: "1900-01-01", versionNo: 1 });
const v2 = version("v2", { effectiveFrom: "2026-10-23", versionNo: 2 });
const v3 = version("v3", { effectiveFrom: "2026-11-22", versionNo: 3 });
const retired = version("v4", {
  status: "RETIRED",
  effectiveFrom: "2026-10-30",
  versionNo: 4,
});
const draft = version("v5", { status: "DRAFT", versionNo: 5 });
const hospital = [v3, retired, draft, v1, v2];

describe("selectEffective (latest effective_from on or before the day)", () => {
  it.each([
    ["2026-10-22", "v1"],
    ["2026-10-23", "v2"],
    ["2026-10-24", "v2"],
    ["2026-11-21", "v2"],
    ["2026-11-22", "v3"],
    ["2030-01-01", "v3"],
  ])("on %s selects %s", (date, expected) => {
    expect(selectEffective(hospital, d(date))?.id).toBe(expected);
  });

  it("never selects RETIRED or DRAFT versions", () => {
    // The retired v4 would otherwise be selected from 2026-10-30.
    expect(selectEffective(hospital, d("2026-10-31"))?.id).toBe("v2");
    expect(selectEffective([draft, retired], d("2030-01-01"))).toBeNull();
  });

  it("is null before the first published version", () => {
    expect(selectEffective([v2], d("2026-10-22"))).toBeNull();
  });
});

describe("effectiveState (derived, never stored)", () => {
  const today = d("2026-11-01");
  it.each([
    [v1, "SUPERSEDED"],
    [v2, "EFFECTIVE"],
    [v3, "SCHEDULED"],
    [retired, "RETIRED"],
    [draft, "DRAFT"],
  ] as const)("%o is %s", (v, state) => {
    expect(effectiveState(v, hospital, today)).toBe(state);
  });

  it("is EFFECTIVE from its first day (immediate publication)", () => {
    expect(effectiveState(v3, hospital, d("2026-11-22"))).toBe("EFFECTIVE");
    expect(effectiveState(v2, hospital, d("2026-11-22"))).toBe("SUPERSEDED");
  });
});

describe("selectForSchedule (pins by period_start, D106)", () => {
  const nicu1 = version("nicu1", {
    departmentId: "nicu",
    effectiveFrom: "2026-11-05",
  });

  it("falls back to the Hospital Default without a department override", () => {
    expect(
      selectForSchedule({
        department: [],
        hospital,
        periodStart: d("2026-10-23"),
      }),
    ).toMatchObject({ ok: true, value: { id: "v2" } });
  });

  it("prefers the department override effective on the period start", () => {
    expect(
      selectForSchedule({
        department: [nicu1],
        hospital,
        periodStart: d("2026-11-22"),
      }),
    ).toMatchObject({ ok: true, value: { id: "nicu1" } });
  });

  it("ignores an override that only becomes effective mid-period", () => {
    // The period starts 2026-10-23; the override starts 2026-11-05.
    expect(
      selectForSchedule({
        department: [nicu1],
        hospital,
        periodStart: d("2026-10-23"),
      }),
    ).toMatchObject({ ok: true, value: { id: "v2" } });
  });

  it("refuses when nothing is effective", () => {
    expect(
      selectForSchedule({
        department: [],
        hospital: [v2],
        periodStart: d("2026-01-01"),
      }),
    ).toMatchObject({
      ok: false,
      error: { reason: NO_EFFECTIVE_RULE_SET, field: "periodStart" },
    });
  });
});
