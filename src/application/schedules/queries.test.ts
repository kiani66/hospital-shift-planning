import { describe, expect, it } from "vitest";

import { isoDate } from "../../domain/shared/dates";
import { defaultSchedule, scheduleForPeriod } from "./queries";

const span = (id: string, start: string, end: string) => ({
  id,
  period: { start: isoDate(start), end: isoDate(end) },
});

// Mehr, Aban, Azar 1405 (whole Jalali months) and a short ad-hoc period.
const mehr = span("mehr", "2026-09-23", "2026-10-22");
const aban = span("aban", "2026-10-23", "2026-11-21");
const azar = span("azar", "2026-11-22", "2026-12-21");

describe("scheduleForPeriod", () => {
  it("finds the schedule of a whole month", () => {
    expect(scheduleForPeriod([mehr, aban, azar], aban.period)).toBe(aban);
  });

  it("is undefined for a month without a schedule, never the nearest one", () => {
    // Dey 1405 lies between no schedule and Azar: nothing covers it.
    const dey = { start: isoDate("2026-12-22"), end: isoDate("2027-01-20") };
    expect(scheduleForPeriod([mehr, aban, azar], dey)).toBeUndefined();
    // Mehr is missing: Aban's neighbours do not stand in for it.
    expect(scheduleForPeriod([aban, azar], mehr.period)).toBeUndefined();
    expect(scheduleForPeriod([], aban.period)).toBeUndefined();
  });

  it("matches on any shared day, inclusive at both ends", () => {
    const lastDay = { start: aban.period.end, end: aban.period.end };
    const firstDay = { start: aban.period.start, end: aban.period.start };
    expect(scheduleForPeriod([aban], lastDay)).toBe(aban);
    expect(scheduleForPeriod([aban], firstDay)).toBe(aban);
    const dayBefore = { start: mehr.period.end, end: mehr.period.end };
    expect(scheduleForPeriod([aban], dayBefore)).toBeUndefined();
  });

  it("picks the earliest when several share the month, whatever the input order", () => {
    const early = span("early", "2026-10-23", "2026-11-05");
    const late = span("late", "2026-11-06", "2026-11-21");
    expect(scheduleForPeriod([late, early], aban.period)).toBe(early);
    expect(scheduleForPeriod([early, late], aban.period)).toBe(early);
  });

  it("does not reorder or modify its input", () => {
    const input = [azar, aban, mehr];
    scheduleForPeriod(input, aban.period);
    expect(input.map((s) => s.id)).toEqual(["azar", "aban", "mehr"]);
  });
});

describe("defaultSchedule (unchanged: still the current or next one)", () => {
  it("skips ended schedules, else takes the latest", () => {
    const today = isoDate("2026-11-01");
    expect(defaultSchedule([mehr, aban, azar], today)).toBe(aban);
    expect(defaultSchedule([mehr], today)).toBe(mehr);
  });
});
