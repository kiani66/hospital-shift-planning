import type { ReviewDay, ReviewFinding } from "@/application/schedules/review";
import type { RuleCode } from "@/domain/rules/diagnostic";
import type { StaffingBounds, StaffingStatus } from "@/domain/rules/staffing";
import type { DayHealth } from "@/domain/schedule/day-health";
import type { IsoDate } from "@/domain/shared/dates";
import type { PreferenceValue, ShiftCode } from "@/domain/shifts/shift-type";
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
  /** Short label for the cell's accessible name, badges and the legend. */
  readonly label: string;
  /** Sentence for the day detail. */
  readonly description: string;
  /** Badge tone (semantic `health-*` tokens through `Badge`). */
  readonly tone: "unplanned" | "valid" | "attention";
  /**
   * Token classes for the month cell. Quiet by default, loud on exceptions:
   * VALID adds nothing (no tint, no colored edge), UNPLANNED is muted, and
   * only NEEDS_ATTENTION gets a tint and an outline.
   */
  readonly cellClass: string;
}

/**
 * VALID is worded as the result of a check («بدون مغایرت», «مغایرتی یافت
 * نشد»; D51), not as a quality of the day: it only says that no violation
 * was found among the implemented, applicable rules. Staffing requirements
 * are not defined yet, so nothing here may imply a fully staffed, complete,
 * approved or finalization-ready day.
 */
export const HEALTH_PRESENTATION: Readonly<
  Record<DayHealth, HealthPresentation>
> = {
  UNPLANNED: {
    label: "برنامه‌ریزی‌نشده",
    description: "برای این روز هنوز شیفتی ثبت نشده است.",
    tone: "unplanned",
    cellClass: "bg-health-unplanned/5",
  },
  VALID: {
    label: "بدون مغایرت",
    description:
      "مغایرتی یافت نشد: در قوانین پیاده‌سازی‌شده فعلی موردی دیده نشد. تأمین نفرات هنوز بررسی نمی‌شود.",
    tone: "valid",
    cellClass: "",
  },
  NEEDS_ATTENTION: {
    label: "نیاز به بررسی",
    description: "در این روز موردی هست که باید بررسی شود.",
    tone: "attention",
    cellClass:
      "bg-health-attention/10 shadow-[inset_0_0_0_1.5px_var(--color-health-attention)]",
  },
};

/** What VALID does and does not mean, once for the whole month (legend). */
export const VALID_CAVEAT = `«${HEALTH_PRESENTATION.VALID.label}» یعنی در قوانین پیاده‌سازی‌شده فعلی موردی یافت نشد؛ تأمین نفرات هنوز بررسی نمی‌شود.`;

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

/** One dated shift a finding is about: "شب · چهارشنبه ۶ آبان ۱۴۰۵". */
export interface FindingFact {
  readonly role: string;
  readonly date: IsoDate;
  readonly dateLabel: string;
  readonly shift: ShiftCode | null;
}

/**
 * The finding's when / which shift, as separate facts for a scannable line
 * (the full sentence of `findingMessage` stays available). Exhaustive over
 * rule codes.
 */
export function findingFacts(finding: ReviewFinding): readonly FindingFact[] {
  const v = finding.violation;
  switch (v.rule) {
    case "NIGHT_REST":
      return [
        {
          role: "شب",
          date: v.nightDate,
          dateLabel: day(v.nightDate),
          shift: "N",
        },
        {
          role: "روز بعد",
          date: v.date,
          dateLabel: day(v.date),
          shift: v.shift,
        },
      ];
    case "DUPLICATE_ASSIGNMENT":
    case "OUTSIDE_PERIOD":
      return [
        {
          role: "روز",
          date: v.date,
          dateLabel: day(v.date),
          shift: finding.shift,
        },
      ];
    default:
      return v satisfies never;
  }
}

/**
 * How the Head Nurse can resolve a finding, in operational words. Exhaustive
 * over rule codes: a new rule does not compile until it says how to fix it.
 */
export function findingResolution(finding: ReviewFinding): string {
  const v = finding.violation;
  switch (v.rule) {
    case "NIGHT_REST":
      return `برای رفع: شیفت ${SHIFT_PRESENTATION[v.shift].name} روز بعد را بردارید یا شیفت شب روز قبل را تغییر دهید.`;
    case "DUPLICATE_ASSIGNMENT":
      return "برای رفع: فقط یک شیفت برای این روز نگه دارید.";
    case "OUTSIDE_PERIOD":
      return "برای رفع: شیفت خارج از دوره را پاک کنید.";
    default:
      return v satisfies never;
  }
}

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
