import { decide } from "../../domain/authz/policies";
import {
  dailyStatistic,
  personStatistic,
  type DayDecisions,
} from "../../domain/excel-export/statistics";
import {
  exportDayValues,
  exportHolidayColumns,
  exportPeriodRow,
  requireTemplateMapping,
  type ExportCellValue,
  type WeekdayFormat,
} from "../../domain/excel-export/template-mapping";
import type { ScheduleStatus } from "../../domain/schedule/status";
import { daysBetween, type IsoDate } from "../../domain/shared/dates";
import { ValidationError } from "../../domain/shared/errors";
import { periodDays, type DatePeriod } from "../../domain/shared/period";
import type { AssignmentCode } from "../../domain/shifts/shift-type";
import { listAssignments } from "../../infrastructure/repositories/assignments";
import { findDepartmentById } from "../../infrastructure/repositories/departments";
import {
  findActiveTemplateWithContent,
  hasActiveTemplate,
  listExportRoster,
} from "../../infrastructure/repositories/excel-templates";
import { findOpenRevision } from "../../infrastructure/repositories/revisions";
import { findScheduleById } from "../../infrastructure/repositories/schedules";
import { listVersionAssignments } from "../../infrastructure/repositories/versions";
import { NO_HOLIDAY_DATA } from "../calendar/holidays";
import { NotFoundError } from "../errors";
import type { AppContext } from "../use-case";
import {
  inspectExcelTemplate,
  populateExcelTemplate,
} from "./template-workbook";

/**
 * Exports a department's monthly schedule into the department's Excel
 * template (D124). A read: one repeatable-read, read-only transaction, no
 * audit row, no change to the schedule or the stored template.
 *
 * Which decisions are written follows the schedule's workflow (D11, D70):
 * the working copy in DRAFT … RETURNED; for an approved schedule (APPROVED,
 * or a revision in progress) the latest approved version, unless the caller
 * explicitly asks for the unapproved revision draft. Rest (OFF) is a blank
 * cell, leave is H, and an undecided day is `?`, never blank (D100). The
 * mapped statistics are recalculated from the same decisions, never copied
 * from the template. The calendar headings (day numbers, weekdays, month)
 * and the holiday highlighting follow the schedule's own dates.
 */

/**
 * Calendar presentation, handed in by the adapter (the Jalali adapter): this
 * layer only sees ISO dates, so no conversion depends on it or on the
 * server's timezone.
 */
export interface ExcelExportCalendar {
  /** The day of the month printed over a date's column (Jalali). */
  dayNumber(date: IsoDate): number;
  /** The Persian weekday of a date. */
  weekday(date: IsoDate, format: WeekdayFormat): string;
  /** The month and year printed in the heading cell, e.g. «مهرماه 1405». */
  monthHeading(period: DatePeriod): string;
}

/** `DEFAULT`: official data; `REVISION_DRAFT`: an open revision's working copy, explicitly. */
export type ExcelExportSource = "DEFAULT" | "REVISION_DRAFT";

export interface ScheduleExcelExport {
  readonly bytes: Uint8Array;
  readonly department: { readonly code: string; readonly name: string };
  readonly period: DatePeriod;
  readonly status: ScheduleStatus;
  /** What was written. */
  readonly source: "WORKING_COPY" | "APPROVED_VERSION" | "REVISION_DRAFT";
  readonly templateVersion: number;
  readonly matched: number;
}

export interface ExcelExportAvailability {
  readonly hasTemplate: boolean;
  /** An approved version exists and a revision is open: the draft is a separate choice. */
  readonly revisionDraftAvailable: boolean;
}

const inApprovedContext = (
  schedule: { status: ScheduleStatus; currentVersionId: string | null },
  revisionOpen: boolean,
) =>
  schedule.currentVersionId !== null &&
  (schedule.status === "APPROVED" || revisionOpen);

async function authorizedSchedule(ctx: AppContext, scheduleId: string) {
  const schedule = await findScheduleById(ctx.db, scheduleId);
  // Unknown and forbidden look the same: no cross-department probing.
  if (
    !schedule ||
    !decide(ctx.actor, "schedule.export", {
      departmentId: schedule.departmentId,
      status: schedule.status,
    }).allowed
  )
    throw new NotFoundError("Schedule");
  return schedule;
}

/** Whether the export button can be offered for this schedule. */
export async function getExcelExportAvailability(
  ctx: AppContext,
  input: { scheduleId: string },
): Promise<ExcelExportAvailability> {
  const schedule = await authorizedSchedule(ctx, input.scheduleId);
  const [hasTemplate, revision] = await Promise.all([
    hasActiveTemplate(ctx.db, schedule.departmentId),
    findOpenRevision(ctx.db, schedule.id),
  ]);
  return {
    hasTemplate,
    revisionDraftAvailable:
      revision !== null && inApprovedContext(schedule, true),
  };
}

const fail = (message: string, reason: string): never => {
  throw new ValidationError(message, "export", reason);
};

export async function exportScheduleToExcel(
  ctx: AppContext,
  input: {
    scheduleId: string;
    source?: ExcelExportSource;
    calendar: ExcelExportCalendar;
  },
): Promise<ScheduleExcelExport> {
  return ctx.db.transaction(
    async (tx) => {
      const scoped = { ...ctx, db: tx };
      const schedule = await authorizedSchedule(scoped, input.scheduleId);
      const department = await findDepartmentById(tx, schedule.departmentId);
      if (!department) throw new NotFoundError("Schedule");
      const template = await findActiveTemplateWithContent(
        tx,
        schedule.departmentId,
      );
      if (!template)
        fail(
          "برای این بخش قالب خروجی Excel بارگذاری نشده است؛ ابتدا در تنظیمات بخش قالب را بارگذاری کنید.",
          "EXCEL_TEMPLATE_MISSING",
        );
      const revision = await findOpenRevision(tx, schedule.id);
      const approved = inApprovedContext(schedule, revision !== null);
      const draft =
        input.source === "REVISION_DRAFT" && approved && revision !== null;
      const source = draft
        ? "REVISION_DRAFT"
        : approved
          ? "APPROVED_VERSION"
          : "WORKING_COPY";
      const [assignments, roster] = await Promise.all([
        source === "APPROVED_VERSION"
          ? listVersionAssignments(tx, schedule.currentVersionId!)
          : listAssignments(tx, schedule.id),
        listExportRoster(tx, schedule.id),
      ]);

      const dates = periodDays(schedule.period);
      const dayCount = dates.length;
      const decisions = new Map<string, Map<number, AssignmentCode>>();
      for (const a of assignments) {
        const day = daysBetween(schedule.period.start, a.date) + 1;
        if (day < 1 || day > dayCount) continue;
        let days = decisions.get(a.nurseId);
        if (!days) decisions.set(a.nurseId, (days = new Map()));
        days.set(day, a.shift);
      }

      const inspection = inspectExcelTemplate(
        template!.content,
        template!.mapping,
      );
      if (!inspection.valid)
        fail(
          `قالب خروجی Excel این بخش معتبر نیست (${inspection.errors[0]!.message})؛ در تنظیمات بخش آن را اصلاح یا جایگزین کنید.`,
          "EXCEL_TEMPLATE_INVALID",
        );
      const inTemplate = new Set(
        inspection.personnel.map((p) => p.personnelNumber),
      );
      // Everyone who can hold a decision in this schedule must have a row:
      // active roster members, and anyone (even a deactivated account) with one.
      const required = roster.filter(
        (r) => r.isActive || decisions.has(r.userId),
      );
      const withoutNumber = required.filter((r) => !r.personnelNumber);
      if (withoutNumber.length > 0)
        fail(
          `شماره پرسنلی این افراد ثبت نشده است و ردیف آن‌ها در قالب پیدا نمی‌شود: ${withoutNumber.map((r) => r.displayName).join("، ")}`,
          "EXCEL_EXPORT_NO_PERSONNEL_NUMBER",
        );
      const missing = required.filter(
        (r) => !inTemplate.has(r.personnelNumber!),
      );
      if (missing.length > 0)
        fail(
          `شماره پرسنلی این افراد در قالب Excel پیدا نشد: ${missing.map((r) => `${r.personnelNumber} (${r.displayName})`).join("، ")}. ردیف آن‌ها را به قالب اضافه یا شماره را اصلاح کنید.`,
          "EXCEL_EXPORT_UNMATCHED",
        );

      const mapping = requireTemplateMapping(template!.mapping);
      const none: DayDecisions = new Map();
      const values = new Map<string, ExportCellValue[]>();
      const statistics = new Map<string, Map<string, ExportCellValue>>();
      for (const r of required) {
        const days = decisions.get(r.userId) ?? none;
        values.set(r.personnelNumber!, exportDayValues(dayCount, days));
        statistics.set(
          r.personnelNumber!,
          new Map(
            mapping.statisticColumns.map((c) => [
              c.column,
              personStatistic(c.statistic, dayCount, days),
            ]),
          ),
        );
      }
      // Nursing coverage counts the roster without secretaries, as staffing does (D119).
      const staffing = required
        .filter((r) => r.role !== "SECRETARY")
        .map((r) => decisions.get(r.userId) ?? none);
      // Fridays, and official holidays once a master calendar is connected
      // (none until then, D41), share one presentation.
      const official = await (
        ctx.holidays ?? NO_HOLIDAY_DATA
      ).listOfficialHolidays(schedule.period);
      const { calendar } = input;
      const bytes = populateExcelTemplate(template!.content, mapping, values, {
        statistics,
        summaries: new Map(
          mapping.summaryRows.map((s) => [
            s.row,
            dailyStatistic(s.statistic, dayCount, staffing),
          ]),
        ),
        dayHeader: exportPeriodRow(dayCount, (i) =>
          calendar.dayNumber(dates[i]!),
        ),
        weekdays: exportPeriodRow(dayCount, (i) =>
          calendar.weekday(dates[i]!, mapping.weekdayFormat),
        ),
        monthHeading: calendar.monthHeading(schedule.period),
        holidays: exportHolidayColumns(
          dates,
          new Set(official.map((h) => h.date)),
        ),
      });
      return {
        bytes,
        department: { code: department.code, name: department.name },
        period: schedule.period,
        status: schedule.status,
        source,
        templateVersion: template!.version,
        matched: roster.filter(
          (r) => r.personnelNumber && inTemplate.has(r.personnelNumber),
        ).length,
      } satisfies ScheduleExcelExport;
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}
