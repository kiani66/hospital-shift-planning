import type { MyPreferenceLock } from "@/application/preferences/queries";
import type { ActionError } from "@/application/result";
import { startOfWeek, type IsoDate } from "@/domain/shared/dates";
import type { PreferenceValue } from "@/domain/shifts/shift-type";
import {
  JALALI_MONTHS,
  faDigits,
  formatJalaliDate,
  formatJalaliRange,
  jalaliWeekday,
  toJalali,
} from "@/features/calendar/jalali";
import { SHIFT_PRESENTATION } from "@/features/shifts/catalog";

/**
 * Persian wording and calendar layout of the nurse's preference page. Dates
 * are converted only through the Phase 4 Jalali adapter; the domain and the
 * server actions see ISO dates.
 *
 * Wording always says "preference" (ترجیح), never "assigned" or "confirmed":
 * a preference is a request; assignment comes later.
 */

export interface PreferenceOption {
  readonly value: PreferenceValue;
  /** The code shown on the button (Latin, as in the shift legend). */
  readonly code: string;
  /** Short Persian label under the code (fits a 5-column row on phones). */
  readonly short: string;
  /** Full name for screen readers and the legend. */
  readonly label: string;
  /** Shift color token classes; always paired with the code text. */
  readonly className: string;
}

/**
 * The approved preference values in display order. `OFF` exists in the
 * persisted model (`preference_value` enum) as "leave / unavailable" and is
 * offered as a rest request.
 */
export const PREFERENCE_OPTIONS: readonly PreferenceOption[] = [
  {
    value: "M",
    code: "M",
    short: "صبح",
    label: "صبح",
    className: SHIFT_PRESENTATION.M.tokenClass,
  },
  {
    value: "E",
    code: "E",
    short: "عصر",
    label: "عصر",
    className: SHIFT_PRESENTATION.E.tokenClass,
  },
  {
    value: "N",
    code: "N",
    short: "شب",
    label: "شب",
    className: SHIFT_PRESENTATION.N.tokenClass,
  },
  {
    value: "ME",
    code: "ME",
    short: "طولانی",
    label: "صبح + عصر (طولانی)",
    className: SHIFT_PRESENTATION.ME.tokenClass,
  },
  {
    value: "OFF",
    code: "OFF",
    short: "استراحت",
    label: "استراحت (عدم تمایل به کار)",
    className: "bg-shift-off text-shift-off-foreground",
  },
];

export const preferenceOption = (value: PreferenceValue): PreferenceOption =>
  PREFERENCE_OPTIONS.find((o) => o.value === value)!;

export const NO_PREFERENCE = "بدون ترجیح";

/** Why a day is read-only, shown next to it (never just a disabled control). */
export const LOCK_REASONS: Record<MyPreferenceLock, string> = {
  WINDOW_CLOSED: "مهلت ثبت ترجیح برای این روز تمام شده است.",
  DATE_NOT_IN_WINDOW: "این روز در بازه ثبت ترجیحات شما نیست.",
  DATE_OUTSIDE_PERIOD: "این روز خارج از دوره برنامه است.",
  SCHEDULE_NOT_ACCEPTING_PREFERENCES:
    "برنامه در این مرحله ترجیح جدید نمی‌پذیرد.",
  NOT_ON_ROSTER: "شما در فهرست پرسنل این برنامه نیستید.",
  NOT_MEMBER:
    "عضویت شما در این بخش پایان یافته است؛ ترجیحات فقط قابل مشاهده است.",
};

/** The most common lock of a read-only schedule, explained once at the top. */
export function scheduleLockMessage(
  locks: readonly (MyPreferenceLock | null)[],
): string | null {
  if (locks.some((l) => l === null)) return null;
  const counts = new Map<MyPreferenceLock, number>();
  for (const l of locks) if (l) counts.set(l, (counts.get(l) ?? 0) + 1);
  const [top] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? [];
  if (!top) return null;
  return top === "WINDOW_CLOSED"
    ? "ثبت ترجیحات بسته شده است. ترجیحات ثبت‌شده شما فقط قابل مشاهده است و دیگر تغییر نمی‌کند."
    : LOCK_REASONS[top];
}

/** Persian messages for a failed save; never raw database errors. */
export function saveErrorMessage(error: ActionError): string {
  switch (error.code) {
    case "FORBIDDEN":
      switch (error.reason) {
        case "WINDOW_CLOSED":
          return "ثبت ترجیحات همین حالا بسته شد؛ تغییر شما ذخیره نشد.";
        case "DATE_NOT_IN_WINDOW":
        case "DATE_OUTSIDE_PERIOD":
        case "SCHEDULE_NOT_ACCEPTING_PREFERENCES":
          return "این روز دیگر قابل ویرایش نیست؛ تغییر شما ذخیره نشد.";
        default:
          return "شما اجازه ثبت ترجیح در این برنامه را ندارید.";
      }
    case "NOT_FOUND":
      return "این برنامه برای شما در دسترس نیست.";
    case "CONFLICT":
      return "ترجیح شما هم‌زمان از جای دیگری تغییر کرد. اطلاعات تازه نمایش داده شد؛ در صورت نیاز دوباره انتخاب کنید.";
    case "VALIDATION":
      return "درخواست معتبر نیست؛ صفحه را دوباره بارگذاری کنید.";
    default:
      return "خطایی رخ داد و ترجیح ذخیره نشد. لطفاً دوباره تلاش کنید.";
  }
}

export interface DayView<D extends { date: IsoDate }> {
  readonly day: D;
  readonly weekday: string;
  /** Day of the Jalali month in Persian digits. */
  readonly dayNumber: string;
  readonly monthName: string;
  /** "شنبه ۲ آبان ۱۴۰۵": the accessible name of the day. */
  readonly fullLabel: string;
  readonly isToday: boolean;
}

export interface WeekView<D extends { date: IsoDate }> {
  /** ISO date of the Saturday that starts the week (stable key). */
  readonly key: IsoDate;
  /** "۲ تا ۸ آبان ۱۴۰۵" (only the days of the period; one day: "۱ آبان ۱۴۰۵"). */
  readonly label: string;
  readonly days: readonly DayView<D>[];
}

/** Groups consecutive days into Saturday-first weeks, with Jalali labels. */
export function groupIntoWeeks<D extends { date: IsoDate }>(
  days: readonly D[],
  today: IsoDate,
): WeekView<D>[] {
  const weeks = new Map<IsoDate, DayView<D>[]>();
  for (const day of days) {
    const j = toJalali(day.date);
    const key = startOfWeek(day.date);
    const list = weeks.get(key) ?? [];
    list.push({
      day,
      weekday: jalaliWeekday(day.date),
      dayNumber: faDigits(j.day),
      monthName: JALALI_MONTHS[j.month - 1]!,
      fullLabel: formatJalaliDate(day.date, { weekday: true }),
      isToday: day.date === today,
    });
    weeks.set(key, list);
  }
  return [...weeks.entries()].map(([key, list]) => ({
    key,
    label:
      list.length === 1
        ? formatJalaliDate(list[0]!.day.date)
        : formatJalaliRange(list[0]!.day.date, list.at(-1)!.day.date),
    days: list,
  }));
}
