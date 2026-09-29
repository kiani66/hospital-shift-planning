import { describe, expect, it } from "vitest";

import { isoDate, type IsoDate } from "../shared/dates";
import type { ScheduleStatus } from "../schedule/status";
import {
  canEditPreference,
  type PreferenceEditContext,
} from "./can-edit-preference";
import {
  countActiveWindows,
  isWindowActive,
  windowCovers,
  type PreferenceWindow,
} from "./preference-window";

const period = { start: isoDate("2026-03-21"), end: isoDate("2026-04-20") };
const now = new Date("2026-03-10T08:00:00Z");
const earlier = new Date("2026-03-09T08:00:00Z");
const later = new Date("2026-03-11T08:00:00Z");

const window = (
  overrides: Partial<PreferenceWindow> = {},
): PreferenceWindow => ({
  kind: "INITIAL",
  dates: new Set<IsoDate>([isoDate("2026-03-28"), isoDate("2026-03-29")]),
  nurseIds: new Set(),
  closesAt: null,
  closedAt: null,
  ...overrides,
});

describe("preference windows", () => {
  it.each<[string, Partial<PreferenceWindow>, boolean]>([
    ["open, no deadline", {}, true],
    ["deadline in the future", { closesAt: later }, true],
    ["deadline passed", { closesAt: earlier }, false],
    ["deadline exactly now", { closesAt: now }, false],
    ["closed manually", { closedAt: earlier }, false],
    [
      "closed with a future deadline",
      { closedAt: earlier, closesAt: later },
      false,
    ],
  ])("isWindowActive: %s → %s", (_, overrides, expected) => {
    expect(isWindowActive(window(overrides), now)).toBe(expected);
  });

  it.each<[string, Partial<PreferenceWindow>, string, string, boolean]>([
    ["all nurses, covered date", {}, "sara", "2026-03-28", true],
    ["all nurses, uncovered date", {}, "sara", "2026-03-30", false],
    [
      "targeted nurse",
      { nurseIds: new Set(["sara"]) },
      "sara",
      "2026-03-28",
      true,
    ],
    [
      "other nurse",
      { nurseIds: new Set(["sara"]) },
      "ali",
      "2026-03-28",
      false,
    ],
  ])("windowCovers: %s → %s", (_, overrides, nurseId, date, expected) => {
    expect(windowCovers(window(overrides), nurseId, isoDate(date))).toBe(
      expected,
    );
  });

  it("countActiveWindows counts only active ones", () => {
    expect(
      countActiveWindows(
        [window(), window({ closedAt: earlier }), window({ closesAt: later })],
        now,
      ),
    ).toBe(2);
    expect(countActiveWindows([], now)).toBe(0);
  });
});

describe("canEditPreference", () => {
  const base: PreferenceEditContext = {
    nurseId: "sara",
    date: isoDate("2026-03-28"),
    schedule: { status: "PLANNING", period },
    onRoster: true,
    windows: [window()],
    now,
  };
  const check = (overrides: Partial<PreferenceEditContext>) =>
    canEditPreference({ ...base, ...overrides });

  it("allows a rostered nurse inside an active window", () => {
    expect(check({})).toEqual({ allowed: true });
  });

  it.each<[string, Partial<PreferenceEditContext>, string]>([
    ["not on the roster", { onRoster: false }, "NOT_ON_ROSTER"],
    [
      "date before the period",
      { date: isoDate("2026-03-20") },
      "DATE_OUTSIDE_PERIOD",
    ],
    [
      "date after the period",
      { date: isoDate("2026-04-21") },
      "DATE_OUTSIDE_PERIOD",
    ],
    ["no windows", { windows: [] }, "NO_ACTIVE_WINDOW"],
    [
      "window closed",
      { windows: [window({ closedAt: earlier })] },
      "NO_ACTIVE_WINDOW",
    ],
    [
      "deadline passed",
      { windows: [window({ closesAt: earlier })] },
      "NO_ACTIVE_WINDOW",
    ],
    [
      "date not in the window",
      { date: isoDate("2026-04-01") },
      "NO_ACTIVE_WINDOW",
    ],
    [
      "window for other nurses",
      { windows: [window({ nurseIds: new Set(["ali"]) })] },
      "NO_ACTIVE_WINDOW",
    ],
  ])("denies: %s", (_, overrides, reason) => {
    expect(check(overrides)).toEqual({ allowed: false, reason });
  });

  it.each<[ScheduleStatus, boolean]>([
    ["DRAFT", false],
    ["PLANNING", true],
    ["FINALIZED", true], // only via an explicitly reopened window
    ["SUBMITTED", false], // frozen under review, even with a stale window
    ["RETURNED", true],
    ["APPROVED", false],
    ["REVISING", true],
  ])("status %s with an active window → allowed=%s", (status, allowed) => {
    const decision = check({ schedule: { status, period } });
    expect(decision.allowed).toBe(allowed);
    if (!decision.allowed)
      expect(decision.reason).toBe("SCHEDULE_NOT_ACCEPTING_PREFERENCES");
  });

  it("RETURNED without a reopened window does not grant editing", () => {
    expect(
      check({ schedule: { status: "RETURNED", period }, windows: [] }),
    ).toEqual({
      allowed: false,
      reason: "NO_ACTIVE_WINDOW",
    });
  });

  it("a targeted reopen grants only the selected dates and nurses", () => {
    const reopen = window({
      kind: "REOPEN",
      dates: new Set([isoDate("2026-04-18")]),
      nurseIds: new Set(["sara", "ali"]),
    });
    const ctx = {
      schedule: { status: "FINALIZED" as const, period },
      windows: [reopen],
    };
    expect(check({ ...ctx, date: isoDate("2026-04-18") }).allowed).toBe(true);
    expect(
      check({ ...ctx, nurseId: "ali", date: isoDate("2026-04-18") }).allowed,
    ).toBe(true);
    expect(
      check({ ...ctx, nurseId: "zahra", date: isoDate("2026-04-18") }).allowed,
    ).toBe(false);
    expect(check({ ...ctx, date: isoDate("2026-04-17") }).allowed).toBe(false);
  });
});
