import type { ScheduleStatus } from "@/domain/schedule/status";
import type { PreferenceCollectionState } from "@/domain/preferences/preference-window";

/** Persian names of the schedule statuses (always shown as text, never by color alone). */
export const SCHEDULE_STATUS_LABELS: Record<ScheduleStatus, string> = {
  DRAFT: "پیش‌نویس",
  PLANNING: "در حال برنامه‌ریزی",
  FINALIZED: "نهایی‌شده",
  SUBMITTED: "ارسال‌شده برای تأیید",
  RETURNED: "برگشت‌خورده",
  APPROVED: "تأییدشده",
  REVISING: "در حال بازنگری",
};

export const PREFERENCE_STATE_LABELS: Record<
  PreferenceCollectionState,
  string
> = {
  NONE: "باز نشده",
  OPEN: "باز",
  CLOSED: "بسته",
};

export const ROLE_LABELS = { NURSE: "پرستار", HEAD_NURSE: "سرپرستار" } as const;
