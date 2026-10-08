import type { ReviewDay, ReviewFinding } from "@/application/schedules/review";
import type { RuleCode } from "@/domain/rules/diagnostic";
import type { StaffingBounds, StaffingStatus } from "@/domain/rules/staffing";
import type { DayState } from "@/domain/rules/validation-summary";
import type { IsoDate } from "@/domain/shared/dates";
import type {
  PreferenceValue,
  AssignmentCode,
} from "@/domain/shifts/shift-type";
import { faNumber, formatJalaliDate } from "@/features/calendar/jalali";
import type { ShiftLabels } from "@/features/shifts/catalog";

/**
 * Wording and visual tokens of the Head Nurse month review. Business states
 * (`DayState`, rule codes, staffing status) are mapped here to Persian text
 * and to semantic `health-*` / `holiday` tokens of `globals.css`; changing a
 * color means changing the token, never a rule. Every state is also carried
 * by an icon and text, never by color alone.
 */

export interface DayStatePresentation {
  /** Short label for the cell's accessible name, badges and the legend. */
  readonly label: string;
  /** Sentence for the day detail. */
  readonly description: string;
  /** Badge tone (semantic tokens through `Badge`). */
  readonly tone: "unplanned" | "valid" | "attention" | "destructive";
  /**
   * Token classes for the month cell. Quiet by default, loud on exceptions:
   * READY adds nothing, NOT_STARTED and UNDECIDED are a muted wash, a
   * coverage problem is tinted amber and a rule violation red (D103).
   */
  readonly cellClass: string;
}

/**
 * A day's primary state (D103). The severity order is
 * RULE_VIOLATION > COVERAGE > UNDECIDED > READY; NOT_STARTED marks a day
 * without any decision yet. The state never hides the other counts: cells
 * and the day detail show every category's count.
 */
export const DAY_STATE_PRESENTATION: Readonly<
  Record<DayState, DayStatePresentation>
> = {
  NOT_STARTED: {
    label: "شروع‌نشده",
    description:
      "برای این روز هنوز هیچ تصمیمی ثبت نشده است. برای نهایی‌سازی، برای همه پرسنل شیفت کاری یا استراحت تعیین و پوشش نفرات را تأمین کنید.",
    tone: "unplanned",
    cellClass: "bg-health-unplanned/5",
  },
  UNDECIDED: {
    label: "تصمیم تعیین‌نشده",
    description:
      "برای برخی پرسنل هنوز تصمیمی (شیفت کاری یا استراحت) ثبت نشده است.",
    tone: "unplanned",
    cellClass: "bg-health-unplanned/5",
  },
  COVERAGE: {
    label: "مشکل پوشش",
    description:
      "پوشش نفرات دست‌کم در یک نوبت خارج از حداقل یا حداکثر قوانین این برنامه است.",
    tone: "attention",
    cellClass:
      "bg-health-attention/10 shadow-[inset_0_0_0_1.5px_var(--color-health-attention)]",
  },
  RULE_VIOLATION: {
    label: "نقض قانون",
    description:
      "در این روز یک قانون برنامه‌ریزی (مثل استراحت پس از شیفت شب) نقض شده است.",
    tone: "destructive",
    cellClass:
      "bg-destructive/5 shadow-[inset_0_0_0_1.5px_var(--color-destructive)]",
  },
  READY: {
    label: "آماده",
    description:
      "این روز آماده نهایی‌سازی است: تصمیم همه پرسنل ثبت شده، پوشش نفرات در محدوده قوانین است و قانونی نقض نشده است.",
    tone: "valid",
    cellClass: "",
  },
};

export const HOLIDAY_LABEL = "تعطیل رسمی";

/** The three categories by name (D102): never "conflict" for an undecided day. */
export const CATEGORY_LABELS = {
  undecided: "تصمیم تعیین‌نشده",
  coverage: "مشکل پوشش",
  shortage: "کمبود نیرو",
  overstaffing: "مازاد نیرو",
  ruleViolation: "نقض قانون",
} as const;

/** A day's non-zero category counts, e.g. "۳ تصمیم تعیین‌نشده، ۱ کمبود نیرو". */
export function dayCountsLabel(day: {
  readonly undecided: number;
  readonly shortages: number;
  readonly overstaffing: number;
  readonly ruleViolations: number;
}): string {
  return [
    [day.ruleViolations, CATEGORY_LABELS.ruleViolation],
    [day.shortages, CATEGORY_LABELS.shortage],
    [day.overstaffing, CATEGORY_LABELS.overstaffing],
    [day.undecided, CATEGORY_LABELS.undecided],
  ]
    .filter(([n]) => (n as number) > 0)
    .map(([n, label]) => `${faNumber(n as number)} ${label}`)
    .join("، ");
}

/** Accessible name of a month cell: date, state, every category's count and holiday. */
export function dayCellLabel(day: ReviewDay): string {
  const counts = dayCountsLabel(day);
  const parts = [
    formatJalaliDate(day.date, { weekday: true }),
    DAY_STATE_PRESENTATION[day.state].label + (counts ? ` (${counts})` : ""),
  ];
  if (day.holiday) parts.push(`${HOLIDAY_LABEL}: ${day.holiday.name}`);
  return parts.join("، ");
}

/** "۱۲ روز" etc. for the month totals. */
export const dayCount = (n: number) => `${faNumber(n)} روز`;

/** The month's counts per category (D104). */
export interface MonthValidationCounts {
  readonly undecided: number;
  readonly undecidedDays: number;
  readonly coverageProblems: number;
  readonly shortages: number;
  readonly overstaffing: number;
  readonly ruleViolations: number;
  readonly readyDays: number;
  readonly totalDays: number;
  readonly ready: boolean;
}

export interface ValidationSummaryText {
  readonly title: string;
  /** One line per category, in severity-neutral reading order. */
  readonly lines: readonly string[];
}

/**
 * The operational monthly summary (D104): never one lumped "blocking
 * conflicts" number. Blocked: what is still open, per category. Clean: that
 * the schedule is ready to finalize, with each category confirmed.
 */
export function validationSummaryText(
  v: MonthValidationCounts,
): ValidationSummaryText {
  if (v.ready)
    return {
      title: "برنامه آماده نهایی‌سازی است.",
      lines: [
        `همه ${dayCount(v.totalDays)} آماده است`,
        "تصمیم تعیین‌نشده‌ای نمانده است",
        "پوشش نفرات در محدوده قوانین است",
        "قانون مسدودکننده‌ای نقض نشده است",
      ],
    };
  const lines: string[] = [];
  if (v.undecided > 0)
    lines.push(
      `${faNumber(v.undecided)} ${CATEGORY_LABELS.undecided} در ${dayCount(v.undecidedDays)}`,
    );
  if (v.coverageProblems > 0) {
    const parts = [
      ...(v.shortages > 0
        ? [`${faNumber(v.shortages)} ${CATEGORY_LABELS.shortage}`]
        : []),
      ...(v.overstaffing > 0
        ? [`${faNumber(v.overstaffing)} ${CATEGORY_LABELS.overstaffing}`]
        : []),
    ];
    lines.push(
      `${faNumber(v.coverageProblems)} ${CATEGORY_LABELS.coverage} (${parts.join("، ")})`,
    );
  }
  if (v.ruleViolations > 0)
    lines.push(
      `${faNumber(v.ruleViolations)} ${CATEGORY_LABELS.ruleViolation}`,
    );
  lines.push(`${faNumber(v.readyDays)} روز از ${dayCount(v.totalDays)} آماده`);
  return { title: "برنامه هنوز آماده نهایی‌سازی نیست.", lines };
}

/** Calendar filters by category (D104). Filters never write; they mark days. */
export const DAY_FILTERS = [
  "undecided",
  "coverage",
  "shortage",
  "overstaffing",
  "violations",
  "ready",
] as const;

export type DayFilter = (typeof DAY_FILTERS)[number];

export const isDayFilter = (value: unknown): value is DayFilter =>
  typeof value === "string" &&
  (DAY_FILTERS as readonly string[]).includes(value);

export const DAY_FILTER_LABELS: Readonly<Record<DayFilter, string>> = {
  undecided: CATEGORY_LABELS.undecided,
  coverage: CATEGORY_LABELS.coverage,
  shortage: CATEGORY_LABELS.shortage,
  overstaffing: CATEGORY_LABELS.overstaffing,
  violations: CATEGORY_LABELS.ruleViolation,
  ready: "روزهای آماده",
};

/** Whether `day` is one of the days `filter` marks. */
export function matchesDayFilter(
  filter: DayFilter,
  day: {
    readonly undecided: number;
    readonly shortages: number;
    readonly overstaffing: number;
    readonly ruleViolations: number;
    readonly ready: boolean;
  },
): boolean {
  switch (filter) {
    case "undecided":
      return day.undecided > 0;
    case "coverage":
      return day.shortages + day.overstaffing > 0;
    case "shortage":
      return day.shortages > 0;
    case "overstaffing":
      return day.overstaffing > 0;
    case "violations":
      return day.ruleViolations > 0;
    case "ready":
      return day.ready;
  }
}

/** Short title of each rule, shown above its message. */
export const RULE_TITLES: Readonly<Record<RuleCode, string>> = {
  NIGHT_REST: "استراحت پس از شیفت شب",
  UNDECIDED: "تصمیم تعیین‌نشده",
  DUPLICATE_ASSIGNMENT: "بیش از یک شیفت در یک روز",
  OUTSIDE_PERIOD: "شیفت خارج از دوره برنامه",
  STAFFING: "پوشش نفرات",
};

const day = (date: IsoDate) => formatJalaliDate(date, { weekday: true });

/**
 * A plain-Persian operational message for a finding, built from its data
 * (never the raw rule code). Exhaustive over rule codes: a new rule does not
 * compile until it has a message.
 */
export function findingMessage(
  finding: ReviewFinding,
  labels: ShiftLabels,
): string {
  const name = `«${finding.nurses.map((n) => n.displayName).join("، ")}»`;
  const v = finding.violation;
  switch (v.rule) {
    case "UNDECIDED":
      return `برای ${name} در ${day(v.date)} هنوز تصمیمی ثبت نشده است؛ شیفت کاری یا ${labels.OFF} را تعیین کنید.`;
    case "NIGHT_REST":
      return `${name} در ${day(v.nightDate)} شیفت ${labels.N} دارد و روز بعد (${day(v.date)}) شیفت ${labels[v.shift]} برایش ثبت شده است؛ پس از شیفت ${labels.N}، روز بعد باید ${labels.OFF} باشد.`;
    case "DUPLICATE_ASSIGNMENT":
      return `برای ${name} در ${day(v.date)} بیش از یک شیفت ثبت شده است؛ هر پرستار در هر روز فقط یک شیفت دارد.`;
    case "OUTSIDE_PERIOD":
      return `برای ${name} در ${day(v.date)} شیفتی ثبت شده که خارج از دوره این برنامه است.`;
    case "STAFFING":
      return v.status === "BELOW_MINIMUM"
        ? `پوشش ${labels[v.period]} در ${day(v.date)} ${faNumber(v.covered)} نفر است؛ حداقل ${faNumber(v.bounds.min!)} نفر لازم است (کمبود ${faNumber(v.bounds.min! - v.covered)} نفر).`
        : `پوشش ${labels[v.period]} در ${day(v.date)} ${faNumber(v.covered)} نفر است؛ حداکثر ${faNumber(v.bounds.max!)} نفر مجاز است (مازاد ${faNumber(v.covered - v.bounds.max!)} نفر).`;
    default:
      return v satisfies never;
  }
}

/** What the finding means for the workflow. */
export const findingSeverityLabel = (finding: ReviewFinding) =>
  finding.blocking ? "مانع نهایی‌سازی" : "هشدار";

/** The category a finding belongs to, by name (D102). */
export function findingCategoryLabel(finding: ReviewFinding): string {
  const v = finding.violation;
  if (v.rule === "UNDECIDED") return CATEGORY_LABELS.undecided;
  if (v.rule === "STAFFING")
    return v.status === "BELOW_MINIMUM"
      ? CATEGORY_LABELS.shortage
      : CATEGORY_LABELS.overstaffing;
  return CATEGORY_LABELS.ruleViolation;
}

/** One dated shift a finding is about: "شب · چهارشنبه ۶ آبان ۱۴۰۵". */
export interface FindingFact {
  readonly role: string;
  readonly date: IsoDate;
  readonly dateLabel: string;
  readonly shift: AssignmentCode | null;
}

/**
 * The finding's when / which shift, as separate facts for a scannable line
 * (the full sentence of `findingMessage` stays available). Exhaustive over
 * rule codes.
 */
export function findingFacts(
  finding: ReviewFinding,
  labels: ShiftLabels,
): readonly FindingFact[] {
  const v = finding.violation;
  switch (v.rule) {
    case "NIGHT_REST":
      return [
        {
          role: labels.N,
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
    case "UNDECIDED":
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
    case "STAFFING":
      return [
        {
          role: "نوبت",
          date: v.date,
          dateLabel: day(v.date),
          shift: v.period,
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
export function findingResolution(
  finding: ReviewFinding,
  labels: ShiftLabels,
): string {
  const v = finding.violation;
  switch (v.rule) {
    case "UNDECIDED":
      return `برای رفع: شیفت کاری یا ${labels.OFF} را تعیین کنید.`;
    case "NIGHT_REST":
      return `برای رفع: شیفت ${labels[v.shift]} روز بعد را بردارید یا شیفت ${labels.N} روز قبل را تغییر دهید.`;
    case "DUPLICATE_ASSIGNMENT":
      return "برای رفع: فقط یک شیفت برای این روز نگه دارید.";
    case "OUTSIDE_PERIOD":
      return "برای رفع: شیفت خارج از دوره را پاک کنید.";
    case "STAFFING":
      return v.status === "BELOW_MINIMUM"
        ? `برای رفع: نفرات نوبت ${labels[v.period]} را افزایش دهید.`
        : `برای رفع: نفرات نوبت ${labels[v.period]} را کاهش دهید.`;
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
      return "در محدوده قوانین";
  }
}

/**
 * Said once for a day whose coverage periods have no minimum or maximum:
 * staffing was not evaluated, so nothing may read as "adequate" (D40, D44).
 */
export const STAFFING_NOT_EVALUATED =
  "تأمین نفرات ارزیابی نشده است؛ حداقل و حداکثر نفرات تعریف نشده است.";

/**
 * What a coverage period's staffing status shows. It only reads the status
 * `staffingStatus` (D44) already decided; the gap is the distance to the
 * bound that status names, never a new rule. WITHIN_BOUNDS is deliberately
 * neutral (no green, no check): it is not a confirmation of adequacy.
 */
export type StaffingIndicator =
  | { readonly kind: "NOT_EVALUATED" }
  | { readonly kind: "WITHIN" }
  | { readonly kind: "SHORTAGE"; readonly gap: number }
  | { readonly kind: "EXCESS"; readonly gap: number };

export function staffingIndicator(coverage: {
  readonly covered: number;
  readonly bounds: StaffingBounds | null;
  readonly status: StaffingStatus;
}): StaffingIndicator {
  switch (coverage.status) {
    case "NOT_CONFIGURED":
      return { kind: "NOT_EVALUATED" };
    case "WITHIN_BOUNDS":
      return { kind: "WITHIN" };
    case "BELOW_MINIMUM":
      return {
        kind: "SHORTAGE",
        gap: coverage.bounds!.min! - coverage.covered,
      };
    case "ABOVE_MAXIMUM":
      return { kind: "EXCESS", gap: coverage.covered - coverage.bounds!.max! };
  }
}

export function staffingIndicatorLabel(indicator: StaffingIndicator): string {
  switch (indicator.kind) {
    case "NOT_EVALUATED":
      return "ارزیابی نشده";
    case "WITHIN":
      return "در محدوده قوانین";
    case "SHORTAGE":
      return `کمبود ${faNumber(indicator.gap)} نفر`;
    case "EXCESS":
      return `مازاد ${faNumber(indicator.gap)} نفر`;
  }
}

/**
 * "حداقل ۳ · حداکثر ۶" from the pinned version; a version without a maximum
 * says «بدون حداکثر», never a guessed number.
 */
export function staffingBoundsLabel(bounds: StaffingBounds | null): string {
  const min =
    bounds?.min === undefined
      ? "حداقل تعریف نشده"
      : `حداقل ${faNumber(bounds.min)}`;
  const max =
    bounds?.max === undefined
      ? "بدون حداکثر"
      : `حداکثر ${faNumber(bounds.max)}`;
  return `${min} · ${max}`;
}

/** "۳–۶" (or "۳+" without a maximum) for compact displays. */
export function staffingRangeLabel(bounds: StaffingBounds | null): string {
  if (!bounds || bounds.min === undefined) return "—";
  return bounds.max === undefined
    ? `${faNumber(bounds.min)}+`
    : `${faNumber(bounds.min)}–${faNumber(bounds.max)}`;
}

/** Labels of the «انطباق با ترجیحات» summary (`PreferenceAlignment`). */
export const ALIGNMENT_LABELS = {
  title: "انطباق با ترجیحات",
  matches: "مطابق ترجیح",
  differs: "مغایر ترجیح",
  pending: "ترجیح ثبت‌شده، در انتظار تخصیص",
  noPreference: "ترجیحی ثبت نشده",
  unassigned: "تعیین‌نشده در این روز",
} as const;

/** Why the four fit counts add up to the roster and «تعیین‌نشده» does not join them. */
export const alignmentPartitionNote = (rostered: number) =>
  `هر نفر فقط در یکی از این چهار دسته است (جمع: ${faNumber(rostered)} نفر).`;

export const ALIGNMENT_OVERLAP_NOTE =
  "جدا شمرده می‌شود و با دسته‌های بالا هم‌پوشانی دارد.";

/** Preferences are wishes (D35): a conflict never invalidates the schedule. */
export const ALIGNMENT_ADVISORY_NOTE =
  "ترجیح‌ها الزامی نیستند؛ مغایرت با ترجیح جلوی نهایی‌سازی برنامه را نمی‌گیرد.";

/** A nurse's own wish for the day, as shown next to their name. */
export function preferenceLabel(
  value: PreferenceValue,
  labels: ShiftLabels,
): string {
  return `ترجیح: ${labels[value]}`;
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
