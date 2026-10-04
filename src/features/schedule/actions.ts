"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import type { ActionError } from "@/application/result";
import { createSchedule } from "@/application/schedules/create-schedule";
import { addRosterMembers } from "@/application/schedules/roster";
import {
  closePreferenceWindow,
  openPreferenceWindow,
} from "@/application/schedules/preference-windows";
import { requireRequestContext } from "@/features/auth/guards";
import {
  faNumber,
  isJalaliMonth,
  jalaliMonthLabel,
  jalaliMonthPeriod,
} from "@/features/calendar/jalali";

/**
 * Thin adapters: parse the form, load the trusted actor, call the use case.
 * Authorization, validation and concurrency live in the use cases; these only
 * translate the result into Persian for the form.
 */

export interface ScheduleFormState {
  readonly status: "idle" | "success" | "error";
  readonly message?: string;
  /** Changes on every submission so the UI can react to repeated results. */
  readonly at?: number;
}

const failure = (message: string): ScheduleFormState => ({
  status: "error",
  message,
  at: Date.now(),
});

const COMMON: Record<ActionError["code"], string> = {
  VALIDATION: "اطلاعات واردشده معتبر نیست.",
  FORBIDDEN: "شما اجازه انجام این کار را در این بخش ندارید.",
  NOT_FOUND: "برنامه یا بخش موردنظر پیدا نشد.",
  INVALID_STATE: "این کار در وضعیت فعلی برنامه امکان‌پذیر نیست.",
  CONFLICT:
    "این برنامه هم‌زمان توسط شخص دیگری تغییر کرده است. اطلاعات تازه نمایش داده شد؛ در صورت نیاز دوباره تلاش کنید.",
  RULE_VIOLATION: "قوانین برنامه‌ریزی اجازه این کار را نمی‌دهند.",
  INTERNAL: "خطای غیرمنتظره‌ای رخ داد. لطفاً دوباره تلاش کنید.",
};

const createForm = z.object({
  departmentId: z.uuid(),
  /** Only used to return to the page; never trusted for authorization. */
  departmentCode: z.string().regex(/^[a-z0-9-]{1,64}$/),
  year: z.coerce.number().int(),
  month: z.coerce.number().int(),
});

export async function createScheduleAction(
  _previous: ScheduleFormState,
  formData: FormData,
): Promise<ScheduleFormState> {
  const form = createForm.safeParse(Object.fromEntries(formData));
  if (!form.success) return failure("لطفاً سال و ماه را انتخاب کنید.");
  const month = { year: form.data.year, month: form.data.month };
  if (!isJalaliMonth(month)) return failure("ماه انتخاب‌شده معتبر نیست.");

  const ctx = await requireRequestContext();
  // Jalali → ISO happens here, in the presentation adapter; only ISO is stored.
  const period = jalaliMonthPeriod(month);
  const result = await createSchedule(ctx, {
    departmentId: form.data.departmentId,
    periodStart: period.start,
    periodEnd: period.end,
    label: jalaliMonthLabel(month),
  });

  if (!result.ok) {
    switch (result.error.code) {
      case "CONFLICT":
        return failure(
          `برای ${jalaliMonthLabel(month)} (یا بخشی از آن) قبلاً در این بخش برنامه ایجاد شده است.`,
        );
      case "VALIDATION":
        return failure(
          result.error.fieldErrors?.period
            ? "در این بازه هیچ عضوی در بخش حضور ندارد؛ فهرست پرسنل برنامه خالی می‌شد."
            : "بازه زمانی انتخاب‌شده معتبر نیست.",
        );
      default:
        return failure(COMMON[result.error.code]);
    }
  }
  redirect(
    `/departments/${form.data.departmentCode}/schedule?schedule=${result.data.scheduleId}`,
  );
}

const scheduleForm = z.object({
  scheduleId: z.uuid(),
  expectedRevision: z.coerce.number().int().nonnegative(),
});

async function runScheduleCommand(
  formData: FormData,
  command: typeof openPreferenceWindow | typeof closePreferenceWindow,
  success: string,
): Promise<ScheduleFormState> {
  const form = scheduleForm.safeParse(Object.fromEntries(formData));
  if (!form.success) return failure(COMMON.VALIDATION);

  const ctx = await requireRequestContext();
  const result = await command(ctx, form.data);
  // Success and stale data both re-render the page with the current state.
  if (result.ok || result.error.code === "CONFLICT") refresh();
  return result.ok
    ? { status: "success", message: success, at: Date.now() }
    : failure(COMMON[result.error.code]);
}

export async function openPreferencesAction(
  _previous: ScheduleFormState,
  formData: FormData,
): Promise<ScheduleFormState> {
  return runScheduleCommand(
    formData,
    openPreferenceWindow,
    "ثبت ترجیحات برای پرسنل برنامه باز شد.",
  );
}

export async function closePreferencesAction(
  _previous: ScheduleFormState,
  formData: FormData,
): Promise<ScheduleFormState> {
  return runScheduleCommand(
    formData,
    closePreferenceWindow,
    "ثبت ترجیحات بسته شد.",
  );
}

const rosterForm = z.object({
  scheduleId: z.uuid(),
  expectedRevision: z.coerce.number().int().nonnegative(),
});

/** Head Nurse adds selected eligible members to a DRAFT/PLANNING roster. */
export async function addRosterMembersAction(
  _previous: ScheduleFormState,
  formData: FormData,
): Promise<ScheduleFormState> {
  const form = rosterForm.safeParse({
    scheduleId: formData.get("scheduleId"),
    expectedRevision: formData.get("expectedRevision"),
  });
  const userIds = formData
    .getAll("userId")
    .filter((v) => typeof v === "string");
  if (!form.success) return failure(COMMON.VALIDATION);
  if (userIds.length === 0)
    return failure("دست‌کم یک نفر را برای افزودن انتخاب کنید.");

  const ctx = await requireRequestContext();
  const result = await addRosterMembers(ctx, { ...form.data, userIds });
  if (result.ok || result.error.code === "CONFLICT") refresh();
  if (result.ok)
    return {
      status: "success",
      message: `${faNumber(result.data.added.length)} نفر به فهرست پرسنل برنامه اضافه شدند. شیفتی برایشان ثبت نشده است.`,
      at: Date.now(),
    };
  switch (result.error.code) {
    case "INVALID_STATE":
      return failure(
        "افزودن پرسنل فقط پیش از نهایی‌سازی (پیش‌نویس یا در حال برنامه‌ریزی) ممکن است.",
      );
    case "VALIDATION":
      if (result.error.reason === "NOT_ELIGIBLE_FOR_ROSTER") {
        refresh();
        return failure(
          "برخی افراد انتخاب‌شده دیگر واجد شرایط نیستند (عضویت یا حساب تغییر کرده یا قبلاً اضافه شده‌اند). فهرست تازه شد؛ دوباره انتخاب کنید.",
        );
      }
      return failure(COMMON.VALIDATION);
    default:
      return failure(COMMON[result.error.code]);
  }
}
