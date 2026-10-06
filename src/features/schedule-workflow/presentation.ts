import type { ActionError } from "@/application/result";
import type { WorkflowBlocker } from "@/application/schedules/workflow";
import type { Violation } from "@/domain/rules/violation";
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
  "finalize" | "submit" | "withdraw" | "approve" | "return" | "discard";

/** The action as the end of "…بتوان آن را ___" ("نهایی کرد"). */
const ACT: Record<LifecycleCommand, string> = {
  finalize: "نهایی کرد",
  submit: "برای تأیید ارسال کرد",
  withdraw: "پس گرفت",
  approve: "تأیید کرد",
  return: "برگشت داد",
  discard: "کنار گذاشت",
};

export const WORKFLOW_SUCCESS: Record<LifecycleCommand, string> = {
  finalize: "برنامه نهایی شد. گام بعد: ارسال برای تأیید سوپروایزر.",
  submit: "برنامه برای تأیید سوپروایزر ارسال شد.",
  withdraw: "ارسال برنامه پس گرفته شد؛ برنامه دوباره نهایی‌شده است.",
  approve: "برنامه تأیید شد.",
  return: "برنامه با توضیح شما برای اصلاح به سرپرستار برگشت داده شد.",
  discard:
    "بازنگری کنار گذاشته شد؛ برنامه به آخرین نسخه تأییدشده برگشت و همان نسخه اجرایی است.",
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

/** The categories a validation blocker consists of (D102). */
export interface ValidationBlockerCounts {
  readonly undecided: number;
  readonly undecidedDays: number;
  readonly coverageProblems: number;
  readonly shortages: number;
  readonly overstaffing: number;
  readonly ruleViolations: number;
}

/**
 * Each open category in its own words (D104): never one lumped
 * "blocking conflicts" number, and an undecided decision is never a conflict.
 */
export function validationBlockerLines(v: ValidationBlockerCounts): string[] {
  const lines: string[] = [];
  if (v.undecided > 0)
    lines.push(
      `${faNumber(v.undecided)} تصمیم تعیین‌نشده در ${faNumber(v.undecidedDays)} روز`,
    );
  if (v.coverageProblems > 0) {
    const parts = [
      ...(v.shortages > 0 ? [`${faNumber(v.shortages)} کمبود نیرو`] : []),
      ...(v.overstaffing > 0 ? [`${faNumber(v.overstaffing)} مازاد نیرو`] : []),
    ];
    lines.push(
      `${faNumber(v.coverageProblems)} مشکل پوشش (${parts.join("، ")})`,
    );
  }
  if (v.ruleViolations > 0)
    lines.push(`${faNumber(v.ruleViolations)} نقض قانون`);
  return lines;
}

/** Why an offered action cannot be taken yet (the header's blocker list). */
export function blockerLabel(
  blocker: WorkflowBlocker,
  validation: ValidationBlockerCounts,
): string {
  switch (blocker) {
    case "VALIDATION": {
      const lines = validationBlockerLines(validation);
      return `برنامه هنوز کامل و معتبر نیست: ${lines.join("؛ ")}.`;
    }
    case "PREFERENCE_WINDOW_OPEN":
      return "ثبت ترجیحات پرستاران هنوز باز است؛ پیش از ارسال، آن را ببندید.";
  }
}

/** The categories of a refused command's violations (the payload keeps the raw list). */
function violationCounts(
  violations: readonly Violation[],
): ValidationBlockerCounts {
  const staffing = violations.filter((v) => v.rule === "STAFFING");
  const undecided = violations.filter((v) => v.rule === "UNDECIDED");
  return {
    undecided: undecided.length,
    undecidedDays: new Set(undecided.map((v) => v.date)).size,
    coverageProblems: staffing.length,
    shortages: staffing.filter((v) => v.status === "BELOW_MINIMUM").length,
    overstaffing: staffing.filter((v) => v.status === "ABOVE_MAXIMUM").length,
    ruleViolations: violations.length - staffing.length - undecided.length,
  };
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
      const violations = error.violations ?? [];
      const lines = validationBlockerLines(violationCounts(violations));
      const dates = uniqueSortedDates(violations.map((v) => v.date));
      if (lines.length === 0)
        return "برنامه هنوز کامل و معتبر نیست؛ روزهای نیازمند اقدام را در تقویم اصلاح کنید.";
      return `این کار انجام نشد، چون برنامه هنوز کامل و معتبر نیست: ${lines.join("؛ ")}.${dates.length ? ` روزهای ${dayList(dates)} را بررسی کنید.` : ""}`;
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
