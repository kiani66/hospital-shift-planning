import { z } from "zod";

import type { ActionError, ActionResult } from "@/application/result";

import type { ManagementOperation } from "./form-schema";

export interface ManagementFormState {
  status: "idle" | "success" | "error";
  message?: string;
  fields?: Readonly<Record<string, string>>;
  /** Safe destination only; command results, passwords and submitted values are never echoed. */
  userId?: string;
  at?: number;
}

export const MANAGEMENT_SUCCESS: Record<ManagementOperation, string> = {
  create: "حساب کاربر ایجاد شد.",
  profile: "اطلاعات حساب ذخیره شد.",
  status: "وضعیت حساب به‌روز شد.",
  add: "عضویت ثبت شد.",
  end: "تاریخ پایان عضویت ثبت شد؛ سابقه حفظ می‌شود.",
  transfer: "انتقال ثبت شد؛ عضویت قبلی و برنامه‌های تاریخی حفظ شدند.",
  role: "تغییر نقش ثبت شد؛ سابقه نقش قبلی حفظ شد.",
  authority:
    "نقش مدیریتی سیستم به‌روز شد؛ وضعیت حساب و روابط بخش تغییر نکردند.",
  supervisorAdd: "دسترسی سوپروایزر ثبت شد؛ عضویت‌های بخش تغییر نکردند.",
  supervisorEnd: "تاریخ پایان دسترسی سوپروایزر ثبت شد؛ سابقه حفظ می‌شود.",
};
const refreshMessage =
  "اطلاعات از زمان باز شدن فرم تغییر کرده است. صفحه را تازه کنید و وضعیت جدید را بررسی کنید.";
const reasonMessages: Record<string, string> = {
  PROFILE_CHANGED: refreshMessage,
  ACCOUNT_STATUS_CHANGED: refreshMessage,
  MEMBERSHIP_CHANGED: refreshMessage,
  ADMIN_AUTHORITY_CHANGED: refreshMessage,
  SUPERVISOR_CHANGED: refreshMessage,
  INVALID_RELATION_RANGE: "تاریخ پایان نمی‌تواند قبل از تاریخ شروع باشد.",
  RELATION_NOT_CURRENT:
    "این رابطه امروز جاری نیست. اطلاعات جدید را بررسی کنید؛ تغییر روابط آینده یا پایان‌یافته در این مرحله مجاز نیست.",
  END_IN_PAST:
    "تاریخ پایان باید امروز یا بعد از امروز باشد؛ سابقه گذشته قابل بازنویسی نیست.",
  TERM_EXTENSION:
    "این عملیات نمی‌تواند مدت عضویت قبلی را تمدید کند. تاریخ را در محدوده مدت ثبت‌شده انتخاب کنید.",
  TRANSITION_HISTORY_BOUNDARY:
    "تاریخ تغییر باید امروز یا بعد از امروز و بعد از اولین روز عضویت قبلی باشد. عضویتی که امروز شروع شده، امروز قابل انتقال یا تغییر نقش نیست.",
  LAST_ACTIVE_ADMIN:
    "آخرین مدیر فعال بیمارستان با امکان ورود باید باقی بماند؛ حذف نقش مدیریتی یا غیرفعال‌سازی حساب او مجاز نیست.",
  ADMIN_GRANT_REQUIRES_CREDENTIALS:
    "برای اعطای دسترسی مدیر بیمارستان، ابتدا باید حساب کاربر دارای امکان ورود باشد.",
  ADMIN_GRANT_REQUIRES_ACTIVE_ACCOUNT:
    "برای اعطای دسترسی مدیر بیمارستان، ابتدا باید حساب کاربر فعال باشد.",
  ADMIN_ACTIVATION_REQUIRES_CREDENTIALS:
    "برای فعال‌سازی حساب دارای نقش مدیر بیمارستان، ابتدا باید امکان ورود کاربر فراهم شود.",
  UNCHANGED_TRANSITION: "بخش یا نقش جدید باید با عضویت فعلی متفاوت باشد.",
};
const fieldMessages: Record<string, string> = {
  displayName: "نام معتبر با حداکثر ۲۰۰ نویسه وارد کنید.",
  email: "ایمیل معتبر و غیرتکراری وارد کنید.",
  password: "رمز اولیه باید بین ۱۲ تا ۲۵۶ نویسه باشد.",
  departmentId: "یک بخش فعال انتخاب کنید.",
  role: "نقش عضویت را انتخاب کنید.",
  startedOn: "تاریخ شروع یا تغییر را بررسی کنید.",
  endedOn: "تاریخ پایان را بررسی کنید.",
  relationId: "رابطه تغییر کرده یا دیگر جاری نیست. صفحه را تازه کنید.",
  hospitalAdmin: reasonMessages.LAST_ACTIVE_ADMIN!,
};

export function managementFailure(
  operation: ManagementOperation,
  error: ActionError,
): ManagementFormState {
  let message = error.reason ? reasonMessages[error.reason] : undefined;
  if (!message) {
    switch (error.code) {
      case "CONFLICT":
        message =
          operation === "create"
            ? "این ایمیل قبلاً ثبت شده است."
            : operation === "profile"
              ? "ایمیل تکراری است یا اطلاعات حساب تغییر کرده است. صفحه را تازه کنید و دوباره بررسی کنید."
              : operation === "authority"
                ? refreshMessage
                : operation === "supervisorAdd" || operation === "supervisorEnd"
                  ? "این بازه با دسترسی سوپروایزر دیگری هم‌پوشانی دارد یا رابطه تغییر کرده است. صفحه را تازه کنید و روابط را بررسی کنید."
                  : "این بازه با عضویت دیگری هم‌پوشانی دارد یا عضویت تغییر کرده است. صفحه را تازه کنید و روابط را بررسی کنید.";
        break;
      case "FORBIDDEN":
        message =
          "اجازه این عملیات را ندارید. دسترسی فقط برای مدیر فعال بیمارستان است.";
        break;
      case "NOT_FOUND":
        message = "کاربر، بخش یا عضویت در دسترس نیست. صفحه را تازه کنید.";
        break;
      case "VALIDATION":
        message = "اطلاعات فرم را بررسی و خطاهای مشخص‌شده را اصلاح کنید.";
        break;
      case "INTERNAL":
        message =
          "ذخیره اطلاعات ممکن نشد. دوباره تلاش کنید؛ اگر نتیجه روشن نیست، ابتدا صفحه را تازه کنید.";
        break;
      default:
        message =
          "این عملیات در وضعیت فعلی مجاز نیست. صفحه را تازه کنید و دوباره بررسی کنید.";
    }
  }
  const fields = Object.fromEntries(
    Object.keys(error.fieldErrors ?? {})
      .filter((key) => fieldMessages[key])
      .map((key) => [
        key,
        error.reason && reasonMessages[error.reason]
          ? message
          : fieldMessages[key]!,
      ]),
  );
  if (error.code === "CONFLICT" && operation === "create")
    fields.email = message;
  return { status: "error", message, fields };
}

export function invalidManagementForm(error: z.ZodError): ManagementFormState {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0]);
    // All schema messages are fixed Persian copy, never input values.
    if (!fields[key])
      fields[key] = /[\u0600-\u06ff]/.test(issue.message)
        ? issue.message
        : "این مقدار معتبر نیست. صفحه را تازه کنید.";
  }
  return {
    status: "error",
    message: "اطلاعات فرم را بررسی و خطاهای مشخص‌شده را اصلاح کنید.",
    fields,
  };
}

/** Deliberately ignore every successful command field; only a validated identity may be returned. */
export function managementResponse<T>(
  operation: ManagementOperation,
  result: ActionResult<T>,
  userId?: string,
): ManagementFormState {
  const createdId =
    operation === "create" && userId && z.uuid().safeParse(userId).success
      ? userId
      : undefined;
  return result.ok
    ? {
        status: "success",
        message: MANAGEMENT_SUCCESS[operation],
        ...(createdId && { userId: createdId }),
      }
    : managementFailure(operation, result.error);
}
