import type { ActionError } from "@/application/result";
import type { DailyPreferenceOutcome } from "@/application/schedules/daily-preferences";

export const reasonLabel: Record<
  NonNullable<DailyPreferenceOutcome["reason"]>,
  string
> = {
  OFF_PREFERENCE: "ترجیح استراحت؛ فقط جهت اطلاع، بدون تخصیص شیفت.",
  NON_NURSING_PREFERENCE:
    "پرسنل غیرپرستاری؛ فقط جهت اطلاع و خارج از پوشش پرستاری.",
  NOT_ON_ROSTER: "این فرد در فهرست پرسنل برنامه نیست.",
  INACTIVE_OR_NOT_MEMBER: "حساب یا عضویت فرد در این تاریخ معتبر نیست.",
  EXISTING_ASSIGNMENT:
    "تصمیم دیگری ثبت شده است؛ پذیرش مستقیم مجاز نیست. تغییر فقط از ویرایش روز انجام می‌شود.",
  RULE_VIOLATION: "پذیرش با قوانین الزامی برنامه سازگار نیست.",
  CAPACITY_CONTENTION:
    "ظرفیت مشترک کافی نیست؛ انتخاب دستی پرستاران لازم است. رد پیشنهاد ظرفیت گروه را برای تأیید جمعی آزاد نمی‌کند.",
  NO_ELIGIBLE_SUGGESTIONS: "پیشنهاد مجاز جدیدی در این گروه وجود ندارد.",
  SESSION_EXCLUDED: "پیشنهاد در این نوبت رد شده است.",
  BATCH_RULE_CONFLICT:
    "پذیرش هم‌زمان این گروه با قوانین الزامی ناسازگار است؛ بررسی و انتخاب دستی لازم است.",
};
export const statusLabel = {
  ELIGIBLE: "مجاز برای تأیید",
  ALREADY_ASSIGNED: "قبلاً تخصیص یافته",
  CONFLICT: "دارای تعارض",
  INFORMATIONAL: "جهت اطلاع",
} as const;
export const outcomeLabel = {
  CREATED: "ثبت شد",
  ALREADY_ASSIGNED: "قبلاً تخصیص یافته",
  INFORMATIONAL: "جهت اطلاع",
  SKIPPED: "ثبت نشد",
} as const;
export function dailyFailure(error: ActionError) {
  const reload = error.code === "CONFLICT" || error.code === "RULE_VIOLATION";
  const messages: Record<ActionError["code"], string> = {
    VALIDATION: "اطلاعات درخواست معتبر نیست. پیشنهادها را دوباره دریافت کنید.",
    FORBIDDEN: "اجازه دسترسی به این برنامه را ندارید.",
    NOT_FOUND: "برنامه در دسترس نیست یا اجازه دسترسی به آن را ندارید.",
    INVALID_STATE:
      "این دستیار فقط در وضعیت پیش‌نویس و برنامه‌ریزی در دسترس است.",
    CONFLICT:
      "ترجیحات یا برنامه تغییر کرده است. پیشنهادهای تازه را بررسی و دوباره تأیید کنید؛ در این درخواست چیزی ثبت نشد.",
    RULE_VIOLATION:
      "قوانین الزامی اجازه ثبت ندادند. پیشنهادهای تازه را بررسی کنید؛ چیزی ثبت نشد.",
    INTERNAL:
      "نتیجه درخواست تأیید نشد. پیش از تلاش دوباره، پیشنهادها را تازه‌سازی کنید.",
  };
  return {
    message: messages[error.code],
    reload,
    violations: error.violations ?? [],
  };
}
