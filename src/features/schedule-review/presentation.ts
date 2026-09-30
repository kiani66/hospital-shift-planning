import type { ReviewDay, ReviewFinding } from "@/application/schedules/review";
import type { RuleCode } from "@/domain/rules/diagnostic";
import type { StaffingBounds, StaffingStatus } from "@/domain/rules/staffing";
import type { DayHealth } from "@/domain/schedule/day-health";
import type { IsoDate } from "@/domain/shared/dates";
import type { PreferenceValue } from "@/domain/shifts/shift-type";
import { faNumber, formatJalaliDate } from "@/features/calendar/jalali";
import { SHIFT_PRESENTATION } from "@/features/shifts/catalog";

/**
 * Wording and visual tokens of the Head Nurse month review. Business states
 * (`DayHealth`, rule codes, staffing status) are mapped here to Persian text
 * and to semantic `health-*` / `holiday` tokens of `globals.css`; changing a
 * color means changing the token, never a rule. Every state is also carried
 * by an icon and text, never by color alone.
 */

export interface HealthPresentation {
  /** Short label for the cell and the legend. */
  readonly label: string;
  /** Sentence for the day detail. */
  readonly description: string;
  /** Token classes for the badge / legend chip. */
  readonly badgeClass: string;
  /** Token classes for the month cell (tint and start border). */
  readonly cellClass: string;
}

/**
 * VALID is worded neutrally («بدون ایراد»): it only says that no violation was
 * found among the implemented, applicable rules. Staffing requirements are
 * not defined yet, so nothing here may imply a fully staffed, complete,
 * approved or finalization-ready day.
 */
export const HEALTH_PRESENTATION: Readonly<
  Record<DayHealth, HealthPresentation>
> = {
  UNPLANNED: {
    label: "برنامه‌ریزی‌نشده",
    description: "برای این روز هنوز شیفتی ثبت نشده است.",
    badgeClass:
      "border-health-unplanned/40 bg-health-unplanned/10 text-health-unplanned-foreground",
    cellClass: "border-s-health-unplanned/60",
  },
  VALID: {
    label: "بدون ایراد",
    description:
      "در قوانین پیاده‌سازی‌شده فعلی موردی یافت نشد؛ تأمین نفرات هنوز بررسی نمی‌شود.",
    badgeClass:
      "border-health-valid/40 bg-health-valid/10 text-health-valid-foreground",
    cellClass: "border-s-health-valid bg-health-valid/5",
  },
  NEEDS_ATTENTION: {
    label: "نیاز به بررسی",
    description: "در این روز موردی هست که باید بررسی شود.",
    badgeClass:
      "border-health-attention/50 bg-health-attention/10 text-health-attention-foreground",
    cellClass: "border-s-health-attention bg-health-attention/10",
  },
};

export const HOLIDAY_LABEL = "تعطیل رسمی";

/** Accessible name of a month cell: date, health, findings and holiday in one sentence. */
export function dayCellLabel(day: ReviewDay): string {
  const findings = day.findings.blocking + day.findings.other;
  const parts = [
    formatJalaliDate(day.date, { weekday: true }),
    HEALTH_PRESENTATION[day.health].label +
      (findings > 0 ? ` (${faNumber(findings)} مورد)` : ""),
  ];
  if (day.holiday) parts.push(`${HOLIDAY_LABEL}: ${day.holiday.name}`);
  return parts.join("، ");
}

/** "۱۲ روز" etc. for the month totals. */
export const dayCount = (n: number) => `${faNumber(n)} روز`;

/** Short title of each rule, shown above its message. */
export const RULE_TITLES: Readonly<Record<RuleCode, string>> = {
  NIGHT_REST: "استراحت پس از شیفت شب",
  DUPLICATE_ASSIGNMENT: "بیش از یک شیفت در یک روز",
  OUTSIDE_PERIOD: "شیفت خارج از دوره برنامه",
};

const day = (date: IsoDate) => formatJalaliDate(date, { weekday: true });

/**
 * A plain-Persian operational message for a finding, built from its data
 * (never the raw rule code). Exhaustive over rule codes: a new rule does not
 * compile until it has a message.
 */
export function findingMessage(finding: ReviewFinding): string {
  const name = `«${finding.nurses.map((n) => n.displayName).join("، ")}»`;
  const v = finding.violation;
  switch (v.rule) {
    case "NIGHT_REST":
      return `${name} در ${day(v.nightDate)} شیفت شب دارد و روز بعد (${day(v.date)}) شیفت ${SHIFT_PRESENTATION[v.shift].name} برایش ثبت شده است؛ پس از شیفت شب، روز بعد باید استراحت باشد.`;
    case "DUPLICATE_ASSIGNMENT":
      return `برای ${name} در ${day(v.date)} بیش از یک شیفت ثبت شده است؛ هر پرستار در هر روز فقط یک شیفت دارد.`;
    case "OUTSIDE_PERIOD":
      return `برای ${name} در ${day(v.date)} شیفتی ثبت شده که خارج از دوره این برنامه است.`;
    default:
      return v satisfies never;
  }
}

/** What the finding means for the workflow. */
export const findingSeverityLabel = (finding: ReviewFinding) =>
  finding.blocking ? "مانع نهایی‌سازی" : "هشدار";

/** Staffing status of a coverage period, in words; no number is ever assumed. */
export function staffingStatusLabel(
  status: StaffingStatus,
  bounds: StaffingBounds | null,
): string {
  switch (status) {
    case "NOT_CONFIGURED":
      return "حداقل و حداکثر نفرات تعریف نشده است";
    case "BELOW_MINIMUM":
      return `کمتر از حداقل (${faNumber(bounds!.min!)} نفر)`;
    case "ABOVE_MAXIMUM":
      return `بیشتر از حداکثر (${faNumber(bounds!.max!)} نفر)`;
    case "WITHIN_BOUNDS":
      return "در محدوده تعریف‌شده";
  }
}

/** A nurse's own wish for the day, as shown next to their name. */
export function preferenceLabel(value: PreferenceValue): string {
  return value === "OFF"
    ? "ترجیح: استراحت"
    : `ترجیح: ${SHIFT_PRESENTATION[value].name}`;
}

/**
 * Up to two initials for the avatar fallback ("سارا نمونه" → "س‌ن"), joined
 * by a zero-width non-joiner so Persian letters stay separate.
 */
export function initials(displayName: string): string {
  return displayName
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0))
    .join("‌");
}
