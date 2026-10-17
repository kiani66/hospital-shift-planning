import type { IsoDate } from "@/domain/shared/dates";
import { toJalali } from "@/features/calendar/jalali";

/**
 * The download name of an exported schedule, from the department code and
 * the schedule's Jalali month only (D124), e.g. `NICU-schedule-1405-07.xlsx`.
 * The month printed inside the template is never edited.
 */
export function scheduleExportFileName(
  departmentCode: string,
  periodStart: IsoDate,
  revisionDraft = false,
): string {
  const { year, month } = toJalali(periodStart);
  const code =
    departmentCode.replace(/[^A-Za-z0-9_-]/g, "").toUpperCase() || "DEPT";
  return `${code}-schedule-${year}-${String(month).padStart(2, "0")}${revisionDraft ? "-revision-draft" : ""}.xlsx`;
}

/** `Content-Disposition` for a download: an ASCII fallback plus the UTF-8 name. */
export function attachmentDisposition(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}
