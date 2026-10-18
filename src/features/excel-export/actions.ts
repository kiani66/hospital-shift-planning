"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { NotFoundError } from "@/application/errors";
import {
  describeTemplateRows,
  prepareTemplatePersonnelColumn,
  previewExcelTemplate,
  templateMappingInput,
  updateExcelTemplateMapping,
  uploadExcelTemplate,
  type TemplatePersonnelEntry,
  type TemplatePreview,
} from "@/application/excel-export/templates";
import { EXCEL_TEMPLATE_LIMITS } from "@/application/excel-export/template-workbook";
import { ValidationError } from "@/domain/shared/errors";
import { requireRequestContext } from "@/features/auth/guards";

export type TemplatePreviewState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | {
      status: "preview";
      inspection: TemplatePreview;
      /** A new file was checked (replacement / first upload), not the stored one. */
      withFile: boolean;
    };

export type TemplateSaveState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "saved"; message: string };

const target = z.object({
  departmentId: z.uuid(),
  departmentCode: z.string().min(1).max(64),
});

/** The uploaded file, if one was chosen; a validation message otherwise. */
async function readFile(
  form: FormData,
): Promise<
  | { kind: "none" }
  | { kind: "file"; name: string; bytes: Uint8Array }
  | { kind: "invalid"; message: string }
> {
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return { kind: "none" };
  if (!/\.xlsx$/i.test(file.name))
    return { kind: "invalid", message: "فقط فایل ‎.xlsx‎ پذیرفته می‌شود." };
  if (file.size > EXCEL_TEMPLATE_LIMITS.maxBytes)
    return { kind: "invalid", message: "حجم فایل قالب حداکثر ۲ مگابایت است." };
  return {
    kind: "file",
    name: file.name,
    bytes: new Uint8Array(await file.arrayBuffer()),
  };
}

/** Comma- or space-separated column letters or row numbers; empty → none. */
const list = (form: FormData, name: string) =>
  String(form.get(name) ?? "")
    .split(/[\s,،]+/)
    .filter(Boolean);
const single = (form: FormData, name: string) => list(form, name).slice(0, 1);

/** The statistics part of the form, one field per supported figure (D124). */
const statisticsOf = (form: FormData) => ({
  dayHeaderRow: single(form, "dayHeaderRow")[0] ?? null,
  statisticColumns: [
    ...single(form, "shiftCountColumn").map((column) => ({
      column,
      statistic: "SHIFT_COUNT",
    })),
    ...single(form, "leaveDaysColumn").map((column) => ({
      column,
      statistic: "LEAVE_DAYS",
    })),
    ...list(form, "clearColumns").map((column) => ({
      column,
      statistic: "CLEAR",
    })),
  ],
  summaryRows: [
    ...single(form, "coverageMRow").map((row) => ({
      row,
      statistic: "COVERAGE_M",
    })),
    ...single(form, "coverageERow").map((row) => ({
      row,
      statistic: "COVERAGE_E",
    })),
    ...single(form, "coverageNRow").map((row) => ({
      row,
      statistic: "COVERAGE_N",
    })),
    ...list(form, "clearRows").map((row) => ({ row, statistic: "CLEAR" })),
    ...list(form, "manualRows").map((row) => ({ row, statistic: "MANUAL" })),
  ],
});

/** The calendar part of the form: weekday row, month heading and holiday fills (D124). */
const calendarOf = (form: FormData) => ({
  weekdayRow: single(form, "weekdayRow")[0] ?? null,
  weekdayFormat: form.get("weekdayFormat") === "NARROW" ? "NARROW" : "LONG",
  monthHeadingCell: single(form, "monthHeadingCell")[0] ?? null,
  holidayFillCell: single(form, "holidayFillCell")[0] ?? null,
  normalFillColumn: single(form, "normalFillColumn")[0] ?? null,
});

const mappingOf = (form: FormData) =>
  templateMappingInput.safeParse({
    sheetName: form.get("sheetName"),
    personnelColumn: form.get("personnelColumn"),
    firstRow: form.get("firstRow"),
    lastRow: form.get("lastRow"),
    firstDayColumn: form.get("firstDayColumn"),
    ...statisticsOf(form),
    ...calendarOf(form),
  });

const failure = (error: unknown) => {
  if (error instanceof ValidationError) return error.message;
  if (error instanceof NotFoundError)
    return "اجازه مدیریت قالب این بخش را ندارید.";
  throw error;
};

/** Checks the file (or the stored template) against the mapping; saves nothing. */
export async function previewTemplateAction(
  form: FormData,
): Promise<TemplatePreviewState> {
  const ids = target.safeParse(Object.fromEntries(form));
  const mapping = mappingOf(form);
  if (!ids.success) return { status: "error", message: "بخش معتبر نیست." };
  if (!mapping.success)
    return {
      status: "error",
      message:
        "همه فیلدهای نگاشت را کامل کنید؛ ردیف‌ها عدد و ستون‌ها حرف ستون Excel هستند.",
    };
  const file = await readFile(form);
  if (file.kind === "invalid")
    return { status: "error", message: file.message };
  const ctx = await requireRequestContext();
  try {
    const inspection = await previewExcelTemplate(ctx, {
      departmentId: ids.data.departmentId,
      mapping: mapping.data,
      ...(file.kind === "file" ? { content: file.bytes } : {}),
    });
    return { status: "preview", inspection, withFile: file.kind === "file" };
  } catch (error) {
    return { status: "error", message: failure(error) };
  }
}

const save = z.object({
  expectedTemplateId: z.union([z.uuid(), z.literal("")]),
  expectedRevision: z.coerce.number().int().min(0),
});

/**
 * Activates a new file (first upload or replacement) or saves the mapping of
 * the stored one. The server validates everything again; the preview only
 * informs the user.
 */
export async function saveTemplateAction(
  form: FormData,
): Promise<TemplateSaveState> {
  const ids = target.safeParse(Object.fromEntries(form));
  const meta = save.safeParse(Object.fromEntries(form));
  const mapping = mappingOf(form);
  if (!ids.success || !meta.success || !mapping.success)
    return { status: "error", message: "فرم معتبر نیست؛ صفحه را تازه کنید." };
  const file = await readFile(form);
  if (file.kind === "invalid")
    return { status: "error", message: file.message };
  const expectedTemplateId = meta.data.expectedTemplateId || null;
  if (
    file.kind === "file" &&
    expectedTemplateId &&
    form.get("confirm") !== "on"
  )
    return {
      status: "error",
      message: "برای جایگزینی، تأیید جایگزینی قالب فعلی لازم است.",
    };
  if (file.kind === "none" && !expectedTemplateId)
    return {
      status: "error",
      message: "ابتدا فایل قالب Excel را انتخاب کنید.",
    };
  const ctx = await requireRequestContext();
  const result =
    file.kind === "file"
      ? await uploadExcelTemplate(ctx, {
          departmentId: ids.data.departmentId,
          expectedTemplateId,
          fileName: file.name,
          content: file.bytes,
          mapping: mapping.data,
        })
      : await updateExcelTemplateMapping(ctx, {
          departmentId: ids.data.departmentId,
          templateId: expectedTemplateId!,
          expectedRevision: meta.data.expectedRevision,
          mapping: mapping.data,
        });
  if (!result.ok)
    return {
      status: "error",
      message:
        result.error.code === "VALIDATION"
          ? result.error.message
          : result.error.code === "CONFLICT"
            ? "قالب یا تنظیمات آن هم‌زمان توسط کاربر دیگری تغییر کرده است؛ صفحه را تازه کنید. تغییری ذخیره نشد."
            : result.error.code === "FORBIDDEN" ||
                result.error.code === "NOT_FOUND"
              ? "اجازه مدیریت قالب این بخش را ندارید."
              : "ذخیره ممکن نشد و قالب فعلی تغییری نکرد.",
    };
  revalidatePath(`/departments/${ids.data.departmentCode}`, "layout");
  revalidatePath("/admin/excel-templates");
  return {
    status: "saved",
    message:
      file.kind === "none"
        ? "تنظیمات نگاشت ذخیره شد."
        : expectedTemplateId
          ? "قالب جدید جایگزین شد و از خروجی بعدی استفاده می‌شود."
          : "قالب بارگذاری و فعال شد.",
  };
}

// ------------------------------------------- personnel-number column (D124)

export type TemplateRowsState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | {
      status: "rows";
      rows: { row: number; label: string }[];
      personnel: TemplatePersonnelEntry[];
    };

export type PreparedTemplateState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "ready"; fileName: string; base64: string; rows: number };

const layout = z.object({
  sheetName: z.string().trim().min(1).max(64),
  firstRow: z.coerce.number().int().min(1),
  lastRow: z.coerce.number().int().min(1),
  firstDayColumn: z.string().trim().min(1).max(8),
});

/** The rows of the chosen file and the department's people; saves nothing. */
export async function describeTemplateRowsAction(
  form: FormData,
): Promise<TemplateRowsState> {
  const ids = target.safeParse(Object.fromEntries(form));
  const fields = layout.safeParse(Object.fromEntries(form));
  if (!ids.success) return { status: "error", message: "بخش معتبر نیست." };
  if (!fields.success)
    return {
      status: "error",
      message: "نام Sheet، ردیف‌های شروع و پایان و ستون روز اول را وارد کنید.",
    };
  const file = await readFile(form);
  if (file.kind !== "file")
    return {
      status: "error",
      message:
        file.kind === "invalid"
          ? file.message
          : "ابتدا فایل Excel بیمارستان را انتخاب کنید.",
    };
  const ctx = await requireRequestContext();
  try {
    return {
      status: "rows",
      ...(await describeTemplateRows(ctx, {
        departmentId: ids.data.departmentId,
        content: file.bytes,
        ...fields.data,
      })),
    };
  } catch (error) {
    return { status: "error", message: failure(error) };
  }
}

const assignment = z.object({
  row: z.coerce.number().int().min(1),
  userId: z.uuid(),
});

/**
 * Writes the chosen people's recorded personnel numbers into an empty
 * column of the file and hides it; returns the new file for download.
 * Nothing is stored: the user reviews it and uploads it as the template.
 */
export async function preparePersonnelColumnAction(
  form: FormData,
): Promise<PreparedTemplateState> {
  const ids = target.safeParse(Object.fromEntries(form));
  const sheetName = z
    .string()
    .trim()
    .min(1)
    .max(64)
    .safeParse(form.get("sheetName"));
  const column = z
    .string()
    .trim()
    .min(1)
    .max(8)
    .safeParse(form.get("targetColumn"));
  if (!ids.success || !sheetName.success || !column.success)
    return {
      status: "error",
      message: "نام Sheet و ستون شماره پرسنلی را وارد کنید.",
    };
  const rows = [];
  for (const [key, value] of form.entries()) {
    const row = /^person-(\d+)$/.exec(key)?.[1];
    if (!row || value === "") continue;
    const parsed = assignment.safeParse({ row, userId: value });
    if (!parsed.success)
      return { status: "error", message: "انتخاب فرد معتبر نیست." };
    rows.push(parsed.data);
  }
  if (rows.length === 0)
    return {
      status: "error",
      message: "برای دست‌کم یک ردیف فرد مربوط را انتخاب کنید.",
    };
  const file = await readFile(form);
  if (file.kind !== "file")
    return {
      status: "error",
      message:
        file.kind === "invalid"
          ? file.message
          : "ابتدا فایل Excel بیمارستان را انتخاب کنید.",
    };
  const ctx = await requireRequestContext();
  try {
    const bytes = await prepareTemplatePersonnelColumn(ctx, {
      departmentId: ids.data.departmentId,
      content: file.bytes,
      sheetName: sheetName.data,
      column: column.data,
      rows,
    });
    return {
      status: "ready",
      fileName: file.name.replace(/\.xlsx$/i, "") + "-personnel.xlsx",
      base64: Buffer.from(bytes).toString("base64"),
      rows: rows.length,
    };
  } catch (error) {
    return { status: "error", message: failure(error) };
  }
}
