import {
  BadgeCheck,
  EyeOff,
  History,
  Hourglass,
  PencilLine,
  type LucideIcon,
} from "lucide-react";
import type { Route } from "next";

import type { MyShiftDay } from "@/application/my-shifts/queries";
import type { BadgeTone } from "@/components/ui/badge";
import type { CALLOUT_TONES } from "@/components/ui/callout";
import type { ShiftPublication } from "@/domain/schedule/publication";
import type { IsoDate } from "@/domain/shared/dates";
import {
  SHIFT_TYPES,
  shiftDurationMinutes,
  type ShiftCode,
} from "@/domain/shifts/shift-type";
import { faNumber, formatJalaliDate } from "@/features/calendar/jalali";
import { SHIFT_PRESENTATION } from "@/features/shifts/catalog";

export interface PublicationPresentation {
  /** Compact label (badges, cell names). */
  readonly label: string;
  /** One distinct shape per state, so the state reads without color. */
  readonly icon: LucideIcon;
  readonly tone: BadgeTone;
  /** The callout tone of the month notice. */
  readonly calloutTone: keyof typeof CALLOUT_TONES;
  /** The notice's first line: what it means for the nurse. */
  readonly headline: string;
  /** Why, and what may still happen. */
  readonly description: string;
  /** Shifts here are not the approved schedule: drawn with a dashed outline. */
  readonly unapproved: boolean;
}

/**
 * The nurse's three readings of a published schedule (and the unpublished
 * planning state), each with its own icon, tone and wording. Only OFFICIAL
 * is green with a check; anything that may still change says so in words,
 * never by color alone. Tones follow the lifecycle badges (D56): awaiting
 * approval is the review violet of SUBMITTED.
 */
export const PUBLICATION_PRESENTATION: Readonly<
  Record<ShiftPublication, PublicationPresentation>
> = {
  NOT_PUBLISHED: {
    label: "در حال برنامه‌ریزی",
    icon: EyeOff,
    tone: "muted",
    calloutTone: "muted",
    headline: "برنامه این ماه هنوز منتشر نشده است",
    description:
      "سرپرستار در حال تهیه برنامه است. شیفت‌های شما پس از نهایی شدن برنامه اینجا نمایش داده می‌شود.",
    unapproved: true,
  },
  TEMPORARY: {
    label: "موقت",
    icon: PencilLine,
    tone: "attention",
    calloutTone: "attention",
    headline: "برنامه موقت است؛ شیفت‌ها ممکن است تغییر کنند",
    description:
      "این برنامه هنوز برای تأیید سوپروایزر ارسال نشده است و سرپرستار می‌تواند هر روز آن را تغییر دهد. پیش از برنامه‌ریزی شخصی، دوباره به این صفحه سر بزنید.",
    unapproved: true,
  },
  AWAITING_APPROVAL: {
    label: "در انتظار تأیید سوپروایزر",
    icon: Hourglass,
    tone: "review",
    calloutTone: "review",
    headline: "در انتظار تأیید سوپروایزر؛ هنوز رسمی نیست",
    description:
      "این برنامه برای تأیید ارسال شده است. اگر سوپروایزر آن را برگرداند، سرپرستار ممکن است شیفت‌ها را تغییر دهد.",
    unapproved: true,
  },
  OFFICIAL: {
    label: "تأییدشده (رسمی)",
    icon: BadgeCheck,
    tone: "success",
    calloutTone: "success",
    headline: "برنامه رسمی و تأییدشده",
    description:
      "سوپروایزر این برنامه را تأیید کرده است. هر تغییری فقط از راه بازنگری و تأیید دوباره انجام می‌شود.",
    unapproved: false,
  },
};

/** A day of an approved schedule that an open revision may change (D14, D70). */
export const CHANGE_PENDING = {
  label: "تغییر در دست بررسی",
  icon: History,
  description:
    "برای این روز بازنگری‌ای در جریان است. تا تأیید آن، شیفت رسمی همان است که می‌بینید.",
} as const;

/** "۸۴ ساعت", "۷ ساعت و ۳۰ دقیقه", "۰ ساعت". */
export function formatHours(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0
    ? `${faNumber(hours)} ساعت`
    : `${faNumber(hours)} ساعت و ${faNumber(rest)} دقیقه`;
}

/** The catalog duration of one shift, e.g. "۱۲ ساعت". */
export const shiftDurationLabel = (code: ShiftCode) =>
  formatHours(shiftDurationMinutes(SHIFT_TYPES[code]));

/** "صبح (M)": the Persian name with the code, for text-only places. */
export const shiftName = (code: ShiftCode) =>
  `${SHIFT_PRESENTATION[code].name} (${code})`;

/**
 * The calendar cell's accessible name: the date, the shift(s) or "no shift",
 * and how settled each one is, e.g. «سه‌شنبه ۴ آبان ۱۴۰۵: شب (N)، موقت».
 */
export function dayCellLabel(
  day: Pick<MyShiftDay, "date" | "entries" | "changePending">,
  options: { selected?: boolean } = {},
): string {
  const date = formatJalaliDate(day.date, { weekday: true });
  const parts =
    day.entries.length === 0
      ? ["بدون شیفت"]
      : day.entries.map((e) =>
          [
            shiftName(e.shift),
            PUBLICATION_PRESENTATION[e.publication].label,
            ...(e.changePending ? [CHANGE_PENDING.label] : []),
          ].join("، "),
        );
  if (day.entries.length === 0 && day.changePending)
    parts.push(CHANGE_PENDING.label);
  const text = `${date}: ${parts.join("؛ ")}`;
  return options.selected ? `${text} (روز انتخاب‌شده)` : text;
}

/** `?month=…&day=…` links keep the month; the day is optional. */
export const myShiftsHref = (month: string, day?: IsoDate): Route =>
  `/my-shifts?month=${month}${day ? `&day=${day}` : ""}` as Route;
