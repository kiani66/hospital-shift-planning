"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { NotFoundError } from "@/application/errors";
import {
  previewExcelTemplate,
  templateMappingInput,
  updateExcelTemplateMapping,
  uploadExcelTemplate,
} from "@/application/excel-export/templates";
import {
  EXCEL_TEMPLATE_LIMITS,
  type TemplateInspection,
} from "@/application/excel-export/template-workbook";
import { ValidationError } from "@/domain/shared/errors";
import { requireRequestContext } from "@/features/auth/guards";

export type TemplatePreviewState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | {
      status: "preview";
      inspection: TemplateInspection;
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

const mappingOf = (form: FormData) =>
  templateMappingInput.safeParse({
    sheetName: form.get("sheetName"),
    personnelColumn: form.get("personnelColumn"),
    firstRow: form.get("firstRow"),
    lastRow: form.get("lastRow"),
    firstDayColumn: form.get("firstDayColumn"),
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
      message: "همه فیلدهای نگاشت را کامل کنید؛ ردیف‌ها عدد هستند.",
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
