import type { Route } from "next";
import type { LucideIcon } from "lucide-react";

import type {
  MyPreferenceDay,
  MyPreferenceLock,
} from "@/application/preferences/queries";
import type { ActionError } from "@/application/result";
import { summarizePreferences } from "@/domain/preferences/my-preferences";
import type { DatePeriod } from "@/domain/shared/period";
import { startOfWeek, type IsoDate } from "@/domain/shared/dates";
import {
  PREFERENCE_VALUES,
  type PreferenceValue,
} from "@/domain/shifts/shift-type";
import {
  JALALI_MONTHS,
  faDigits,
  formatJalaliDate,
  formatJalaliDayRange,
  jalaliMonthParam,
  jalaliWeekday,
  toJalali,
  type JalaliMonth,
} from "@/features/calendar/jalali";
import { SHIFT_DISPLAY } from "@/features/shifts/catalog";

/**
 * Persian wording and calendar layout of the nurse's preference page. Dates
 * are converted only through the Jalali adapter; the domain and the server
 * actions see ISO dates.
 *
 * Wording always says "preference" (ترجیح), never "assigned" or "confirmed":
 * a preference is a request; assignment comes later. Having no preference is
 * a normal, valid state (preferences are optional), never a warning.
 */

export interface PreferenceOption {
  readonly value: PreferenceValue;
  /** The code shown on the button (Latin, as in the shift legend). */
  readonly code: string;
  /** Short Persian name: under the code, in «ترجیح من: …» and the summary. */
  readonly short: string;
  /** Full name for screen readers. */
  readonly label: string;
  /** Shift color token classes; always paired with the code text. */
  readonly className: string;
  /** Decorative icon from the shared shift presentation. */
  readonly icon: LucideIcon;
}

/**
 * The approved preference values in display order, from the shared shift
 * presentation (`SHIFT_DISPLAY`). `OFF` exists in the persisted model as
 * "leave / unavailable" and is offered as a rest request (D35); it is a
 * preference here, not an assignment.
 */
export const PREFERENCE_OPTIONS: readonly PreferenceOption[] =
  PREFERENCE_VALUES.map((value) => {
    const shift = SHIFT_DISPLAY[value];
    return {
      value,
      code: shift.code,
      short: shift.name,
      label: shift.fullName,
      className: shift.tokenClass,
      icon: shift.icon,
    };
  });

export const preferenceOption = (value: PreferenceValue): PreferenceOption =>
  PREFERENCE_OPTIONS.find((o) => o.value === value)!;

export const NO_PREFERENCE = "بدون ترجیح";

/** «ترجیح من: صبح», or «بدون ترجیح»: once per card, never repeated. */
export const myPreferenceText = (value: PreferenceValue | null): string =>
  value === null ? NO_PREFERENCE : `ترجیح من: ${preferenceOption(value).short}`;

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

export const CLOSED_HEADLINE = "مهلت ثبت ترجیحات این ماه به پایان رسیده است";

/**
 * The headline of a read-only month (no day editable), from its most common
 * lock; null while any day is editable.
 */
export function closedMonthHeadline(
  locks: readonly (MyPreferenceLock | null)[],
): string | null {
  if (locks.some((l) => l === null)) return null;
  const counts = new Map<MyPreferenceLock, number>();
  for (const l of locks) if (l) counts.set(l, (counts.get(l) ?? 0) + 1);
  const [top] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? [];
  if (!top) return null;
  return top === "WINDOW_CLOSED" ? CLOSED_HEADLINE : LOCK_REASONS[top];
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
      return "ترجیح شما هم‌زمان از جای دیگری تغییر کرد؛ دوباره تلاش کنید.";
    case "VALIDATION":
      return "درخواست معتبر نیست؛ صفحه را دوباره بارگذاری کنید.";
    default:
      return "خطایی رخ داد و ترجیح ذخیره نشد. لطفاً دوباره تلاش کنید.";
  }
}

/** Whether sending the same choice again can succeed (a closed window cannot). */
export const isRetryableSaveError = (error: ActionError): boolean =>
  error.code !== "FORBIDDEN" &&
  error.code !== "NOT_FOUND" &&
  error.code !== "VALIDATION";

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

export interface DayGroup<D extends { date: IsoDate }> {
  /** ISO date of the group's first day (stable key). */
  readonly key: IsoDate;
  /**
   * The group's real dates, never a week number: "۱ آبان", "۲ تا ۸ آبان",
   * "۲۹ مهر تا ۵ آبان". Groups follow Saturday-first calendar weeks, cut to
   * the days of the schedule.
   */
  readonly label: string;
  readonly days: readonly DayView<D>[];
  readonly containsToday: boolean;
}

export function dayView<D extends { date: IsoDate }>(
  day: D,
  today: IsoDate,
): DayView<D> {
  const j = toJalali(day.date);
  return {
    day,
    weekday: jalaliWeekday(day.date),
    dayNumber: faDigits(j.day),
    monthName: JALALI_MONTHS[j.month - 1]!,
    fullLabel: formatJalaliDate(day.date, { weekday: true }),
    isToday: day.date === today,
  };
}

/** Groups consecutive days by Saturday-first week, labelled with their dates. */
export function groupDays<D extends { date: IsoDate }>(
  days: readonly D[],
  today: IsoDate,
): DayGroup<D>[] {
  const groups = new Map<IsoDate, DayView<D>[]>();
  for (const day of days) {
    const key = startOfWeek(day.date);
    const list = groups.get(key) ?? [];
    list.push(dayView(day, today));
    groups.set(key, list);
  }
  return [...groups.values()].map((list) => ({
    key: list[0]!.day.date,
    label: formatJalaliDayRange(list[0]!.day.date, list.at(-1)!.day.date),
    days: list,
    containsToday: list.some((d) => d.isToday),
  }));
}

/** The group open on arrival: the one with today, else the first. */
export const initiallyOpenGroup = <D extends { date: IsoDate }>(
  groups: readonly DayGroup<D>[],
): IsoDate | null =>
  (groups.find((g) => g.containsToday) ?? groups[0])?.key ?? null;

export interface PreferenceCounts {
  readonly byValue: Readonly<Record<PreferenceValue, number>>;
  /** Days without a preference: informational, never an error. */
  readonly none: number;
  readonly days: number;
}

/** How many days carry each preference, and how many have none. */
export function countPreferences(
  values: readonly (PreferenceValue | null)[],
): PreferenceCounts {
  const summary = summarizePreferences(
    values.filter((v): v is PreferenceValue => v !== null),
  );
  const { total, ...byValue } = summary;
  return { byValue, none: values.length - total, days: values.length };
}

/** The days that carry a preference, for the read-only summary of a month. */
export const daysWithPreference = (
  days: readonly MyPreferenceDay[],
): (MyPreferenceDay & { value: PreferenceValue })[] =>
  days.filter(
    (d): d is MyPreferenceDay & { value: PreferenceValue } => d.value !== null,
  );

/** `/preferences?month=1405-08`, optionally with one schedule of that month. */
export const preferencesHref = (month: JalaliMonth, scheduleId?: string) =>
  `/preferences?month=${jalaliMonthParam(month)}${
    scheduleId ? `&schedule=${scheduleId}` : ""
  }` as Route;

/** The Jalali month a schedule belongs to: the month of its first day. */
export const monthOfPeriod = (period: DatePeriod): JalaliMonth => {
  const j = toJalali(period.start);
  return { year: j.year, month: j.month };
};

export const MONTH_STATE_LABEL = {
  OPEN: "باز برای ثبت",
  CLOSED: "بسته",
  NONE: "ثبت ترجیحات باز نشده",
} as const;
