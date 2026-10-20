import { describe, expect, it } from "vitest";
import { isoDate, type IsoDate } from "../shared/dates";
import {
  canConfirmCalendar,
  validateCalendarImport,
  type CalendarSource,
  type ImportedHoliday,
} from "./official-calendar";

// Synthetic publication and dates exercise validation only; no official holiday dataset is shipped.
const period = { start: isoDate("2026-03-21"), end: isoDate("2027-03-20") };
const source: CalendarSource = {
  publisher: "Synthetic test publisher",
  title: "Test fixture",
  url: "https://calendar.example.invalid/fixture",
  documentSha256: "a".repeat(64),
  retrievedOn: isoDate("2026-10-20"),
  verificationNote: "Synthetic test evidence",
  verified: true,
};
const holiday: ImportedHoliday = {
  date: period.start,
  names: ["Synthetic event", "Second fixture event"],
  provisional: false,
};

describe("official calendar source and confirmation rules", () => {
  it("accepts a verified complete publication and multiple names on one date", () => {
    expect(
      validateCalendarImport(period, "COMPLETE", source, [holiday]).ok,
    ).toBe(true);
    expect(
      canConfirmCalendar({
        completeness: "COMPLETE",
        source,
        days: [
          {
            date: period.start,
            isFriday: false,
            officialStatus: "OFFICIAL",
            holidayNames: holiday.names,
          },
        ],
      }).ok,
    ).toBe(true);
  });
  it("keeps unverified future lunar dates provisional and incomplete", () => {
    const unverified = { ...source, verified: false };
    const provisional = { ...holiday, provisional: true };
    expect(
      validateCalendarImport(period, "PARTIAL", unverified, [provisional]).ok,
    ).toBe(true);
    expect(
      validateCalendarImport(period, "PARTIAL", unverified, [holiday]).ok,
    ).toBe(false);
    expect(validateCalendarImport(period, "COMPLETE", unverified, []).ok).toBe(
      false,
    );
    expect(
      validateCalendarImport(period, "COMPLETE", source, [provisional]).ok,
    ).toBe(false);
  });
  it.each([
    [{ ...holiday, date: "not-a-date" as IsoDate }],
    [{ ...holiday, date: isoDate("2026-03-20") }],
    [{ ...holiday, date: isoDate("2027-03-21") }],
    [holiday, holiday],
    [{ ...holiday, names: [] }],
    [{ ...holiday, names: [" "] }],
    [{ ...holiday, names: ["duplicate", "duplicate"] }],
  ])(
    "rejects dates or names that cannot form one year snapshot",
    (...holidays) => {
      expect(
        validateCalendarImport(period, "PARTIAL", source, holidays).ok,
      ).toBe(false);
    },
  );
  it("rejects unknown, partial, unverified and provisional confirmation", () => {
    for (const completeness of ["UNKNOWN", "PARTIAL"] as const)
      expect(canConfirmCalendar({ completeness, source, days: [] }).ok).toBe(
        false,
      );
    expect(
      canConfirmCalendar({ completeness: "COMPLETE", source: null, days: [] })
        .ok,
    ).toBe(false);
    expect(
      canConfirmCalendar({
        completeness: "COMPLETE",
        source: { ...source, verified: false },
        days: [],
      }).ok,
    ).toBe(false);
    for (const officialStatus of ["UNKNOWN", "PROVISIONAL"] as const)
      expect(
        canConfirmCalendar({
          completeness: "COMPLETE",
          source,
          days: [
            {
              date: period.start,
              isFriday: false,
              officialStatus,
              holidayNames: [],
            },
          ],
        }).ok,
      ).toBe(false);
  });
});
