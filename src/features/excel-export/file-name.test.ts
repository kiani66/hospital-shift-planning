import { describe, expect, it } from "vitest";

import { isoDate } from "@/domain/shared/dates";

import { attachmentDisposition, scheduleExportFileName } from "./file-name";

describe("scheduleExportFileName", () => {
  it("names the file after the department and the Jalali month", () => {
    // 1 Mehr 1405.
    expect(scheduleExportFileName("nicu", isoDate("2026-09-23"))).toBe(
      "NICU-schedule-1405-07.xlsx",
    );
    expect(scheduleExportFileName("icu", isoDate("2026-10-23"), true)).toBe(
      "ICU-schedule-1405-08-revision-draft.xlsx",
    );
  });

  it("keeps only safe characters of the code", () => {
    expect(scheduleExportFileName('a"/b', isoDate("2026-03-21"))).toBe(
      "AB-schedule-1405-01.xlsx",
    );
    expect(scheduleExportFileName("بخش", isoDate("2026-03-21"))).toBe(
      "DEPT-schedule-1405-01.xlsx",
    );
  });
});

describe("attachmentDisposition", () => {
  it("has an ASCII fallback and the exact UTF-8 name", () => {
    expect(attachmentDisposition('قالب "x".xlsx')).toBe(
      `attachment; filename="____ _x_.xlsx"; filename*=UTF-8''${encodeURIComponent('قالب "x".xlsx')}`,
    );
  });
});
