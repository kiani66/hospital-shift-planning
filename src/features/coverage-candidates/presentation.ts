import type { IsoDate } from "@/domain/shared/dates";
import type { ActionError } from "@/application/result";
import type {
  AvailableCandidateView,
  CandidateNurse,
} from "@/application/schedules/coverage-candidates";
import type { ReviewFinding } from "@/application/schedules/review";
import type { CandidateShift } from "@/domain/candidates/evaluate-candidates";
import { toDiagnostic } from "@/domain/rules/diagnostic";
import type { Violation } from "@/domain/rules/violation";
import type { DatePeriod } from "@/domain/shared/period";
import { formatJalaliDate } from "@/features/calendar/jalali";
import { editFailure } from "@/features/schedule-editing/presentation";
import type { ShiftLabels } from "@/features/shifts/catalog";

import type {
  CandidateDayStatus,
  CandidatePreference,
} from "@/domain/candidates/evaluate-candidates";

export const candidateDayLabel: Record<CandidateDayStatus, string> = {
  UNASSIGNED: "شیفت روز: تعیین‌نشده",
  OFF_ASSIGNMENT: "شیفت روز: OFF — برای تخصیص شیفت، تصمیم OFF باید تغییر کند.",
};
export function candidatePreferenceLabel(
  preference: CandidatePreference,
  labels: ShiftLabels,
): string {
  switch (preference) {
    case "SAME_SHIFT":
      return "ترجیح: همین شیفت";
    case "NONE":
      return "ترجیح: ثبت نشده";
    case "DIFFERENT_SHIFT":
      return "ترجیح: شیفت دیگر";
    case "OFF_PREFERENCE":
      return `ترجیح: OFF — درخواست ${labels.OFF}؛ مانع انتخاب نیست.`;
    default:
      return preference satisfies never;
  }
}
export const candidateQueryError = "دریافت افراد ممکن نشد. دوباره تلاش کنید.";
export const candidateAccessError =
  "برنامه در دسترس نیست یا اجازه مشاهده آن را ندارید.";

/** OFF preference never requires replacement confirmation. */
export const needsOffConfirmation = (
  candidate: Pick<
    AvailableCandidateView,
    "dayStatus" | "requiresOffReplacement"
  >,
) =>
  candidate.dayStatus === "OFF_ASSIGNMENT" || candidate.requiresOffReplacement;

export const candidateAssignLabel = (
  shift: CandidateShift,
  labels: ShiftLabels,
) => `تخصیص شیفت ${labels[shift]}`;
export const candidateCompletionMessage = (
  shift: CandidateShift,
  labels: ShiftLabels,
) => `پوشش موردنیاز شیفت ${labels[shift]} تکمیل شد.`;
export const candidateSavedMessage = (
  shift: CandidateShift,
  name: string,
  labels: ShiftLabels,
) => `شیفت ${labels[shift]} برای «${name}» ثبت شد.`;
export const offReplacementMessage = (
  candidate: AvailableCandidateView,
  date: IsoDate,
  shift: CandidateShift,
  labels: ShiftLabels,
) =>
  `«${candidate.displayName}» در ${formatJalaliDate(date)} OFF است. با ادامه، تصمیم OFF حذف و شیفت ${labels[shift]} جایگزین می‌شود.`;

export type CandidateFailureKind =
  | "NO_SHORTAGE"
  | "STALE"
  | "UNAVAILABLE"
  | "WORKING"
  | "RULE"
  | "FORBIDDEN"
  | "LOCKED"
  | "INVALID"
  | "SERVER";
export interface CandidateWriteFailure {
  readonly kind: CandidateFailureKind;
  readonly message: string;
  readonly refresh: boolean;
  readonly violations?: readonly Violation[];
}

export const candidateNetworkFailure: CandidateWriteFailure = {
  kind: "SERVER",
  refresh: false,
  message: "ثبت شیفت تأیید نشد. دوباره بررسی و تلاش کنید.",
};

export function candidateWriteFailure(
  error: ActionError,
): CandidateWriteFailure {
  if (error.code === "CONFLICT") {
    switch (error.reason) {
      case "NO_SHORTAGE":
        return {
          kind: "NO_SHORTAGE",
          refresh: true,
          message: "کمبود این شیفت قبلاً برطرف شده است.",
        };
      case "NOT_A_CANDIDATE":
        return {
          kind: "UNAVAILABLE",
          refresh: true,
          message: "این پرستار دیگر برای این شیفت در دسترس نیست.",
        };
      case "CANDIDATE_ALREADY_WORKING":
        return {
          kind: "WORKING",
          refresh: true,
          message: "برای این پرستار در این روز قبلاً شیفت کاری ثبت شده است.",
        };
      default:
        return {
          kind: "STALE",
          refresh: true,
          message: "برنامه از زمان نمایش این فهرست تغییر کرده است.",
        };
    }
  }
  if (error.code === "RULE_VIOLATION")
    return {
      kind: "RULE",
      refresh: true,
      message:
        "تخصیص این شیفت با قوانین برنامه سازگار نیست. دلایل زیر مربوط به بررسی تخصیص فرضی هستند.",
      violations: error.violations,
    };
  const failure = editFailure(error);
  return {
    kind: failure.kind === "CONFLICT" ? "STALE" : failure.kind,
    message: failure.message,
    refresh: failure.kind !== "SERVER" && failure.kind !== "INVALID",
  };
}

/** Reuse review diagnostics for the command's hypothetical blocking findings. */
export function candidateWriteFindings(
  violations: readonly Violation[],
  period: DatePeriod,
  candidate: CandidateNurse,
): readonly ReviewFinding[] {
  return violations.map((violation) => {
    const diagnostic = toDiagnostic(violation, period);
    return {
      ...diagnostic,
      nurses: diagnostic.nurseIds.map((userId) => ({
        userId,
        displayName: userId === candidate.userId ? candidate.displayName : "—",
      })),
    };
  });
}
