import type {
  CandidateDayStatus,
  CandidatePreference,
} from "@/domain/candidates/evaluate-candidates";

export const candidateDayLabel: Record<CandidateDayStatus, string> = {
  UNASSIGNED: "شیفت روز: تعیین‌نشده",
  OFF_ASSIGNMENT: "شیفت روز: OFF — برای تخصیص شیفت، تصمیم OFF باید تغییر کند.",
};
export const candidatePreferenceLabel: Record<CandidatePreference, string> = {
  SAME_SHIFT: "ترجیح: همین شیفت",
  NONE: "ترجیح: ثبت نشده",
  DIFFERENT_SHIFT: "ترجیح: شیفت دیگر",
  OFF_PREFERENCE: "ترجیح: OFF — درخواست استراحت؛ مانع انتخاب نیست.",
};
export const candidateQueryError = "دریافت افراد ممکن نشد. دوباره تلاش کنید.";
export const candidateAccessError =
  "برنامه در دسترس نیست یا اجازه مشاهده آن را ندارید.";
