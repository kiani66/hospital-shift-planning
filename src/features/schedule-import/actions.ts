"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  commitScheduleImport,
  previewScheduleImport,
  type ScheduleImportPreview,
} from "@/application/schedule-import/import";
import { SCHEDULE_IMPORT_LIMITS } from "@/application/schedule-import/workbook";
import { DomainError } from "@/domain/shared/errors";
import { requireRequestContext } from "@/features/auth/guards";
import {
  isJalaliMonth,
  jalaliMonthLabel,
  jalaliMonthPeriod,
} from "@/features/calendar/jalali";

export type ExcelPreviewState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "preview"; preview: ScheduleImportPreview };
export type ExcelCommitState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "committed"; scheduleId: string; assignments: number };
const target = z.object({
  departmentId: z.uuid(),
  year: z.coerce.number().int(),
  month: z.coerce.number().int(),
});
export async function previewExcelAction(
  _previous: ExcelPreviewState,
  form: FormData,
): Promise<ExcelPreviewState> {
  const input = target.safeParse(Object.fromEntries(form));
  if (!input.success || !isJalaliMonth(input.data))
    return { status: "error", message: "بخش، سال و ماه معتبر را انتخاب کنید." };
  const file = form.get("file");
  if (
    !(file instanceof File) ||
    !/\.xlsx$/i.test(file.name) ||
    file.size > SCHEDULE_IMPORT_LIMITS.maxBytes
  )
    return {
      status: "error",
      message: "فایل .xlsx با حجم حداکثر ۵۱۲ کیلوبایت انتخاب کنید.",
    };
  const ctx = await requireRequestContext();
  try {
    const period = jalaliMonthPeriod(input.data);
    const preview = await previewScheduleImport(
      ctx,
      {
        departmentId: input.data.departmentId,
        periodStart: period.start,
        periodEnd: period.end,
        label: jalaliMonthLabel(input.data),
      },
      new Uint8Array(await file.arrayBuffer()),
    );
    return { status: "preview", preview };
  } catch (error) {
    return {
      status: "error",
      message:
        error instanceof DomainError && error.code === "VALIDATION"
          ? error.message
          : "بررسی فایل ممکن نشد؛ دسترسی بخش و ساختار فایل را بررسی کنید.",
    };
  }
}
export async function commitExcelAction(
  _previous: ExcelCommitState,
  form: FormData,
): Promise<ExcelCommitState> {
  if (form.get("confirm") !== "on")
    return { status: "error", message: "برای ثبت، پیش‌نمایش را تأیید کنید." };
  const ctx = await requireRequestContext();
  const raw = form.get("payload");
  let payload: unknown;
  try {
    payload =
      typeof raw === "string" && raw.length <= 512 * 1024
        ? JSON.parse(raw)
        : null;
  } catch {
    payload = null;
  }
  const result = await commitScheduleImport(ctx, payload);
  if (!result.ok)
    return {
      status: "error",
      message:
        result.error.code === "CONFLICT"
          ? "برنامه، پرسنل یا پیش‌نمایش تغییر کرده است؛ فایل را دوباره بررسی کنید. هیچ تغییری ثبت نشد."
          : result.error.code === "FORBIDDEN"
            ? "اجازه ثبت برنامه این بخش را ندارید."
            : "ثبت ممکن نشد و هیچ تغییری اعمال نشد؛ فایل و وضعیت برنامه را دوباره بررسی کنید.",
    };
  revalidatePath("/", "layout");
  return {
    status: "committed",
    scheduleId: result.data.scheduleId,
    assignments: result.data.assignments,
  };
}
