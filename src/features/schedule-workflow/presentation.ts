import type { ActionError } from "@/application/result";
import type { WorkflowBlocker } from "@/application/schedules/workflow";
import { PREFERENCE_WINDOW_OPEN } from "@/domain/schedule/state-machine";
import { uniqueSortedDates, type IsoDate } from "@/domain/shared/dates";
import {
  faDigits,
  faNumber,
  JALALI_MONTHS,
  toJalali,
} from "@/features/calendar/jalali";

/**
 * Persian wording of the approval workflow (Phase 8). The server decides;
 * this only explains its answers: stable codes and reasons in, sentences
 * out. Nothing here shows a raw code or a technical message.
 */

export type LifecycleCommand =
  "finalize" | "submit" | "withdraw" | "approve" | "return";

/** The action as the end of "…بتوان آن را ___" ("نهایی کرد"). */
const ACT: Record<LifecycleCommand, string> = {
  finalize: "نهایی کرد",
  submit: "برای تأیید ارسال کرد",
  withdraw: "پس گرفت",
  approve: "تأیید کرد",
  return: "برگشت داد",
};

export const WORKFLOW_SUCCESS: Record<LifecycleCommand, string> = {
  finalize: "برنامه نهایی شد. گام بعد: ارسال برای تأیید سوپروایزر.",
  submit: "برنامه برای تأیید سوپروایزر ارسال شد.",
  withdraw: "ارسال برنامه پس گرفته شد؛ برنامه دوباره نهایی‌شده است.",
  approve: "برنامه تأیید شد.",
  return: "برنامه با توضیح شما برای اصلاح به سرپرستار برگشت داده شد.",
};

/** "۴ آبان" (the month's day and name; the year is the page's). */
export function shortJalaliDay(date: IsoDate): string {
  const j = toJalali(date);
  return `${faDigits(j.day)} ${JALALI_MONTHS[j.month - 1]}`;
}

/** "۴ آبان، ۶ آبان و ۲ روز دیگر": at most `max` days named. */
export function dayList(dates: readonly IsoDate[], max = 4): string {
  const named = dates.slice(0, max).map(shortJalaliDay);
  const rest = dates.length - named.length;
  if (rest > 0) return `${named.join("، ")} و ${faNumber(rest)} روز دیگر`;
  if (named.length <= 1) return named.join("");
  return `${named.slice(0, -1).join("، ")} و ${named.at(-1)}`;
}

/** Why an offered action cannot be taken yet (the header's blocker list). */
export function blockerLabel(
  blocker: WorkflowBlocker,
  findings: { readonly count: number; readonly dates: readonly IsoDate[] },
): string {
  switch (blocker) {
    case "BLOCKING_FINDINGS": {
      const where = findings.dates.length
        ? ` در ${dayList(findings.dates)}`
        : "";
      return `${faNumber(findings.count)} مغایرت مسدودکننده${where} باید برطرف شود.`;
    }
    case "PREFERENCE_WINDOW_OPEN":
      return "ثبت ترجیحات پرستاران هنوز باز است؛ پیش از ارسال، آن را ببندید.";
  }
}

const GENERIC: Record<ActionError["code"], string> = {
  VALIDATION: "اطلاعات واردشده معتبر نیست.",
  FORBIDDEN: "شما اجازه انجام این کار را برای این برنامه ندارید.",
  NOT_FOUND: "برنامه موردنظر پیدا نشد.",
  INVALID_STATE: "این کار در وضعیت فعلی برنامه امکان‌پذیر نیست.",
  CONFLICT: "",
  RULE_VIOLATION: "",
  INTERNAL: "خطای غیرمنتظره‌ای رخ داد. لطفاً دوباره تلاش کنید.",
};

/**
 * The message for a refused lifecycle command. Stale data and a state that
 * changed underneath (someone else acted first) say so and that the page now
 * shows the current state; blocking findings name the days to fix.
 */
export function workflowErrorMessage(
  command: LifecycleCommand,
  error: ActionError,
): string {
  switch (error.code) {
    case "CONFLICT":
      return "برنامه هم‌زمان تغییر کرده است (برای نمونه، شخص دیگری زودتر اقدام کرده است). وضعیت تازه نمایش داده شد؛ پیش از تکرار، آن را بررسی کنید.";
    case "RULE_VIOLATION": {
      const dates = uniqueSortedDates(
        (error.violations ?? []).map((v) => v.date),
      );
      const count = error.violations?.length ?? 0;
      return dates.length
        ? `${faNumber(count)} مغایرت مسدودکننده مانع این کار است؛ روزهای ${dayList(dates)} را بررسی و اصلاح کنید.`
        : "مغایرت‌های مسدودکننده مانع این کار است؛ روزهای نیازمند بررسی را اصلاح کنید.";
    }
    case "INVALID_STATE":
      if (error.reason === PREFERENCE_WINDOW_OPEN)
        return "ثبت ترجیحات پرستاران هنوز باز است؛ پیش از ارسال، آن را ببندید.";
      return `این برنامه دیگر در وضعیتی نیست که بتوان آن را ${ACT[command]}. وضعیت تازه نمایش داده شد.`;
    case "FORBIDDEN":
      if (error.reason === "SELF_APPROVAL")
        return "این برنامه را خودتان ارسال کرده‌اید؛ تأیید یا برگشت آن با سوپروایزر دیگری است.";
      return GENERIC.FORBIDDEN;
    case "VALIDATION":
      if (command === "return" && error.fieldErrors?.comment)
        return "توضیح برگشت را بنویسید (حداکثر ۱۰۰۰ نویسه)؛ سرپرستار بر اساس آن برنامه را اصلاح می‌کند.";
      return GENERIC.VALIDATION;
    default:
      return GENERIC[error.code];
  }
}
