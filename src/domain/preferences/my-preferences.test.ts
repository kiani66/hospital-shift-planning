import { describe, expect, it } from "vitest";

import { isoDate, type IsoDate } from "../shared/dates";
import type { PreferenceEditContext } from "./can-edit-preference";
import {
  preferenceDayAccess,
  summarizePreferences,
  windowDates,
  windowsForNurse,
} from "./my-preferences";
import type { PreferenceWindow } from "./preference-window";

const period = { start: isoDate("2026-10-23"), end: isoDate("2026-11-21") };
const now = new Date("2026-10-01T08:00:00Z");
const earlier = new Date("2026-09-30T08:00:00Z");

const window = (
  overrides: Partial<PreferenceWindow> = {},
): PreferenceWindow => ({
  kind: "INITIAL",
  dates: new Set<IsoDate>([isoDate("2026-10-23"), isoDate("2026-10-24")]),
  nurseIds: new Set(),
  closesAt: null,
  closedAt: null,
  ...overrides,
});

describe("windowsForNurse", () => {
  it("keeps whole-roster windows and those naming the nurse", () => {
    const all = window();
    const mine = window({ nurseIds: new Set(["sara"]) });
    const theirs = window({ nurseIds: new Set(["ali"]) });
    expect(windowsForNurse([all, mine, theirs], "sara")).toEqual([all, mine]);
    expect(windowsForNurse([theirs], "sara")).toEqual([]);
  });
});

describe("preferenceDayAccess", () => {
  const base: PreferenceEditContext = {
    nurseId: "sara",
    date: isoDate("2026-10-23"),
    schedule: { status: "PLANNING", period },
    onRoster: true,
    windows: [window()],
    now,
  };
  const check = (overrides: Partial<PreferenceEditContext>) =>
    preferenceDayAccess({ ...base, ...overrides });

  it("allows a covered day in an active window", () => {
    expect(check({})).toEqual({ allowed: true });
  });

  it("explains a covered day whose window was closed", () => {
    expect(check({ windows: [window({ closedAt: earlier })] })).toEqual({
      allowed: false,
      reason: "WINDOW_CLOSED",
    });
    expect(check({ windows: [window({ closesAt: earlier })] })).toEqual({
      allowed: false,
      reason: "WINDOW_CLOSED",
    });
  });

  it("explains a day no window of the nurse ever covered", () => {
    expect(check({ date: isoDate("2026-10-25") })).toEqual({
      allowed: false,
      reason: "DATE_NOT_IN_WINDOW",
    });
    expect(
      check({ windows: [window({ nurseIds: new Set(["ali"]) })] }),
    ).toEqual({ allowed: false, reason: "DATE_NOT_IN_WINDOW" });
    expect(check({ windows: [] })).toEqual({
      allowed: false,
      reason: "DATE_NOT_IN_WINDOW",
    });
  });

  it("passes the other denials through unchanged", () => {
    expect(check({ onRoster: false })).toEqual({
      allowed: false,
      reason: "NOT_ON_ROSTER",
    });
    expect(check({ date: isoDate("2026-11-22") })).toEqual({
      allowed: false,
      reason: "DATE_OUTSIDE_PERIOD",
    });
    expect(check({ schedule: { status: "SUBMITTED", period } })).toEqual({
      allowed: false,
      reason: "SCHEDULE_NOT_ACCEPTING_PREFERENCES",
    });
  });

  it("does not apply the night-rest rule to wishes", () => {
    // N on D and a shift on D+1 are both editable: preferences are requests.
    expect(check({ date: isoDate("2026-10-24") })).toEqual({ allowed: true });
  });
});

describe("summarizePreferences", () => {
  it("counts each value and the total", () => {
    expect(summarizePreferences(["M", "N", "M", "ME", "OFF", "E"])).toEqual({
      M: 2,
      E: 1,
      N: 1,
      ME: 1,
      OFF: 1,
      total: 6,
    });
    expect(summarizePreferences([])).toEqual({
      M: 0,
      E: 0,
      N: 0,
      ME: 0,
      OFF: 0,
      total: 0,
    });
  });
});

describe("windowDates", () => {
  it("unions the dates of every window", () => {
    const other = window({ dates: new Set([isoDate("2026-10-30")]) });
    expect([...windowDates([window(), other])].sort()).toEqual([
      "2026-10-23",
      "2026-10-24",
      "2026-10-30",
    ]);
  });
});
