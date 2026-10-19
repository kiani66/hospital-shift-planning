import type { CopyReason } from "@/domain/schedule/copy";
import type { ActionError } from "@/application/result";

export const COPY_REASONS: Record<CopyReason, string> = {
  TARGET_DATE_DOES_NOT_EXIST: "روز متناظر در دوره مقصد وجود ندارد.",
  NURSE_NOT_IN_TARGET_ROSTER: "فرد در فهرست پرسنل برنامه مقصد نیست.",
  NOT_ELIGIBLE_ON_TARGET_DATE:
    "حساب فعال یا عضویت معتبر بخش در روز مقصد وجود ندارد.",
  SOURCE_LEAVE_NOT_COPIED: "مرخصی مبدأ مربوط به همان تاریخ است و کپی نمی‌شود.",
  TARGET_ASSIGNMENT_ALREADY_EXISTS:
    "تصمیم قبلی مقصد حفظ می‌شود؛ بازنویسی انجام نمی‌شود.",
  LEAVE_CONFLICT: "مرخصی ثبت‌شده مقصد حفظ می‌شود.",
  TARGET_SCHEDULE_NOT_EDITABLE: "برنامه مقصد در وضعیت فعلی قابل ویرایش نیست.",
  DATE_OUTSIDE_REVISION_SCOPE: "روز مقصد در محدوده بازنگری بازشده نیست.",
};
export function copyErrorMessage(error: ActionError) {
  if (error.code === "CONFLICT")
    return "داده‌ها یا پیش‌نمایش تغییر کرده‌اند؛ دوباره پیش‌نمایش بگیرید. هیچ تغییری ثبت نشد.";
  if (error.code === "FORBIDDEN" || error.code === "NOT_FOUND")
    return "اجازه کپی این برنامه‌ها را ندارید یا برنامه در دسترس نیست.";
  if (error.code === "RULE_VIOLATION")
    return "قوانین برنامه مقصد اجازه ثبت این مجموعه را نمی‌دهند. هیچ تغییری ثبت نشد.";
  if (error.code === "VALIDATION" || error.code === "INVALID_STATE")
    return "بازه، انتخاب پرسنل و وضعیت برنامه را بررسی کنید. هیچ تغییری ثبت نشد.";
  return "ارتباط یا ثبت با خطا روبه‌رو شد؛ پیش از تلاش دوباره پیش‌نمایش بگیرید.";
}
