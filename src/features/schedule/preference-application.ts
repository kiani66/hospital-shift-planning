import type { PreferenceSkipReason } from "@/domain/preferences/apply-monthly";
import type { IsoDate } from "@/domain/shared/dates";
import { formatJalaliDate } from "@/features/calendar/jalali";

const SKIP_LABELS: Record<PreferenceSkipReason, string> = {
  OUTSIDE_PERIOD: "تاریخ خارج از دوره برنامه است.",
  NOT_ON_ROSTER: "فرد در فهرست پرسنل این برنامه نیست.",
  INACTIVE_OR_NOT_MEMBER: "حساب غیرفعال است یا فرد در این تاریخ عضو بخش نیست.",
  LEAVE_PRESERVED: "مرخصی (H) ثبت‌شده حفظ شد؛ ترجیح جایگزین مرخصی نمی‌شود.",
};

export const preferenceSkipMessage = (item: {
  displayName: string | null;
  date: IsoDate;
  reason: PreferenceSkipReason;
}) =>
  `${item.displayName ?? "پرسنل خارج از فهرست"}، ${formatJalaliDate(item.date)}: ${SKIP_LABELS[item.reason]}`;
