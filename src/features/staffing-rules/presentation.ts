import type { ActionError } from "@/application/result";
import type {
  ApplicationHistoryEntry,
  RuleSetHistoryEntry,
} from "@/application/staffing-rules/history";
import type { IsoDate } from "@/domain/shared/dates";
import { COVERAGE_PERIODS, type BaseShift } from "@/domain/shifts/shift-type";
import type {
  CoverageBounds,
  RuleSetContent,
} from "@/domain/staffing-rules/model";
import type { EffectiveState } from "@/domain/staffing-rules/selection";
import { faNumber, formatJalaliDate } from "@/features/calendar/jalali";
import { parseJalaliInput } from "@/features/calendar/jalali-input";

/**
 * Persian wording of staffing rule sets (D105–D110). The server decides;
 * this only explains: stable codes and reasons in, sentences out.
 */

export const RULE_SET_STATE_LABELS: Readonly<Record<EffectiveState, string>> = {
  DRAFT: "پیش‌نویس",
  SCHEDULED: "زمان‌بندی‌شده",
  EFFECTIVE: "جاری",
  SUPERSEDED: "جایگزین‌شده با نسخه بعدی",
  RETIRED: "بازنشسته",
};

export const RULE_SET_STATE_TONES = {
  DRAFT: "info",
  SCHEDULED: "review",
  EFFECTIVE: "success",
  SUPERSEDED: "muted",
  RETIRED: "muted",
} as const satisfies Record<EffectiveState, string>;

/** "پیش‌فرض بیمارستان" or "قوانین ویژه — بخش NICU" (the name carries «بخش»). */
export const scopeLabel = (departmentName: string | null) =>
  departmentName === null
    ? "پیش‌فرض بیمارستان"
    : `قوانین ویژه — ${departmentName}`;

/** "نسخه ۳" */
export const versionLabel = (versionNo: number) =>
  `نسخه ${faNumber(versionNo)}`;

/** "۳ تا ۶ نفر" or "دست‌کم ۱ نفر" (no maximum). */
export const boundsText = (b: CoverageBounds) =>
  b.max === null
    ? `دست‌کم ${faNumber(b.min)} نفر`
    : b.max === b.min
      ? `دقیقاً ${faNumber(b.min)} نفر`
      : `${faNumber(b.min)} تا ${faNumber(b.max)} نفر`;

/** When a version takes effect, in words; the legacy baseline has always applied. */
export function effectiveFromText(version: {
  readonly effectiveFrom: IsoDate | null;
  readonly legacyBaseline: boolean;
}): string {
  if (version.legacyBaseline) return "از ابتدا (قانون پیشین سامانه)";
  return version.effectiveFrom
    ? `از ${formatJalaliDate(version.effectiveFrom)}`
    : "هنوز منتشر نشده";
}

export const BUCKET_NAMES: Readonly<Record<BaseShift, string>> = {
  M: "صبح",
  E: "عصر",
  N: "شب",
};

/** A short line per day type, e.g. "صبح ۳ تا ۶ نفر · عصر … · شب …". */
export const dayTypeSummary = (
  bounds: Readonly<Partial<Record<BaseShift, CoverageBounds>>>,
) =>
  COVERAGE_PERIODS.filter((p) => bounds[p])
    .map((p) => `${BUCKET_NAMES[p]} ${boundsText(bounds[p]!)}`)
    .join(" · ");

/** The content input the commands accept (`ruleSetContentInput`). */
export interface ContentFormValue {
  readonly normal: Record<BaseShift, { min: number; max: number | null }>;
  readonly holiday: Partial<
    Record<BaseShift, { min: number; max: number | null }>
  >;
  readonly exceptions: {
    date: string;
    period: BaseShift;
    bounds: { min: number; max: number | null };
    note: string | null;
  }[];
}

export type ContentFormResult =
  | { readonly ok: true; readonly value: ContentFormValue }
  | { readonly ok: false; readonly message: string };

const toNumber = (value: FormDataEntryValue | null): number | null => {
  if (typeof value !== "string") return null;
  const latin = value
    .trim()
    .replace(/[۰-۹٠-٩]/g, (digit) =>
      String(digit.charCodeAt(0) - (digit >= "۰" ? 0x06f0 : 0x0660)),
    );
  if (latin === "") return null;
  return /^\d{1,3}$/.test(latin) ? Number(latin) : Number.NaN;
};

/**
 * Reads the draft editor's form: NORMAL min/max per bucket (max may be empty
 * for "no maximum"), optional HOLIDAY bounds per bucket, and date exceptions
 * with Jalali dates. Ranges are checked again by the domain.
 */
export function parseContentForm(form: FormData): ContentFormResult {
  const bucket = (prefix: string, p: BaseShift) => {
    const min = toNumber(form.get(`${prefix}.${p}.min`));
    const max = toNumber(form.get(`${prefix}.${p}.max`));
    return { min, max };
  };
  const normal = {} as ContentFormValue["normal"];
  for (const p of COVERAGE_PERIODS) {
    const { min, max } = bucket("normal", p);
    if (min === null || Number.isNaN(min) || Number.isNaN(max))
      return {
        ok: false,
        message: `حداقل نفرات ${BUCKET_NAMES[p]} را با عدد وارد کنید (حداکثر را می‌توانید خالی بگذارید).`,
      };
    normal[p] = { min, max };
  }
  const holiday: ContentFormValue["holiday"] = {};
  for (const p of COVERAGE_PERIODS) {
    if (form.get(`holiday.${p}.enabled`) !== "on") continue;
    const { min, max } = bucket("holiday", p);
    if (min === null || Number.isNaN(min) || Number.isNaN(max))
      return {
        ok: false,
        message: `حداقل نفرات ${BUCKET_NAMES[p]} در روز تعطیل را با عدد وارد کنید.`,
      };
    holiday[p] = { min, max };
  }
  const dates = form.getAll("exception.date");
  const periods = form.getAll("exception.period");
  const mins = form.getAll("exception.min");
  const maxes = form.getAll("exception.max");
  const notes = form.getAll("exception.note");
  const exceptions: ContentFormValue["exceptions"] = [];
  for (let i = 0; i < dates.length; i++) {
    const date = parseJalaliInput(dates[i]);
    const period = periods[i];
    const min = toNumber(mins[i] ?? null);
    const max = toNumber(maxes[i] ?? null);
    if (!date)
      return {
        ok: false,
        message: `تاریخ استثنای ردیف ${faNumber(i + 1)} معتبر نیست (نمونه: ۱۴۰۵/۰۸/۱۵).`,
      };
    if (period !== "M" && period !== "E" && period !== "N")
      return { ok: false, message: "نوبت استثنا را انتخاب کنید." };
    if (min === null || Number.isNaN(min) || Number.isNaN(max))
      return {
        ok: false,
        message: `حداقل نفرات استثنای ردیف ${faNumber(i + 1)} را با عدد وارد کنید.`,
      };
    const note =
      typeof notes[i] === "string" ? (notes[i] as string).trim() : "";
    exceptions.push({
      date,
      period,
      bounds: { min, max },
      note: note || null,
    });
  }
  return { ok: true, value: { normal, holiday, exceptions } };
}

/** The editor's initial values from stored content. */
export const contentFormValue = (
  content: RuleSetContent,
): ContentFormValue => ({
  normal: { ...content.normal },
  holiday: { ...content.holiday },
  exceptions: content.exceptions.map((e) => ({
    date: e.date,
    period: e.period,
    bounds: { ...e.bounds },
    note: e.note,
  })),
});

/** Persian message for a refused rule-set command. */
export function ruleSetErrorMessage(error: ActionError): string {
  switch (error.code) {
    case "CONFLICT":
      if (error.reason === "RULE_SET_PUBLISH_CONFLICT")
        return "انتشار با نسخه‌های زمان‌بندی‌شده تداخل دارد. تداخل را بررسی کنید و جایگزینی آن نسخه‌ها را صریحاً تأیید کنید.";
      if (error.reason === "RULE_SET_DRAFT_EXISTS")
        return "برای این دامنه یک پیش‌نویس باز وجود دارد؛ همان را ویرایش یا حذف کنید.";
      return "این نسخه هم‌زمان تغییر کرده است. اطلاعات تازه نمایش داده شد؛ دوباره تلاش کنید.";
    case "VALIDATION":
      if (error.reason === "EFFECTIVE_FROM_IN_PAST")
        return "تاریخ اجرا نمی‌تواند پیش از امروز باشد.";
      return "مقادیر واردشده معتبر نیست: حداقل و حداکثر باید عدد صحیح ۰ تا ۹۹ باشند و حداکثر کمتر از حداقل نباشد؛ برای هر تاریخ و نوبت فقط یک استثنا مجاز است.";
    case "INVALID_STATE":
      if (error.reason === "RETIRE_EFFECTIVE_HOSPITAL_DEFAULT")
        return "نسخه جاری یا پیشین پیش‌فرض بیمارستان را نمی‌توان کنار گذاشت؛ به‌جای آن نسخه تازه‌ای منتشر کنید.";
      return "نسخه منتشرشده یا بازنشسته قابل تغییر نیست؛ برای هر تغییر نسخه تازه‌ای بسازید.";
    case "FORBIDDEN":
      return "فقط مدیر بیمارستان می‌تواند قوانین پوشش را تعریف یا منتشر کند.";
    case "NOT_FOUND":
      return "نسخه یا بخش موردنظر پیدا نشد.";
    default:
      return "خطای غیرمنتظره‌ای رخ داد. لطفاً دوباره تلاش کنید.";
  }
}

/** Why Apply is not possible for a schedule now (D107, D109). */
export function applyRefusalText(reason: string): string {
  switch (reason) {
    case "APPLY_RULE_SET_WHILE_SUBMITTED":
      return "این برنامه برای تأیید ارسال شده و قفل است. اعمال قوانین پس از تصمیم سوپروایزر یا پس گرفتن ارسال ممکن است.";
    case "APPLY_RULE_SET_REQUIRES_REVISION":
      return "برنامه تأییدشده مستقیماً تغییر نمی‌کند. ابتدا سرپرستار باید «شروع بازنگری» را بزند؛ سپس می‌توانید قوانین دیگری را اعمال کنید.";
    case "RULE_SET_ALREADY_PINNED":
      return "این برنامه هم‌اکنون به همین نسخه متصل است.";
    default:
      return "اعمال این نسخه برای این برنامه ممکن نیست.";
  }
}

/** Persian message for a refused Apply. */
export function applyErrorMessage(error: ActionError): string {
  switch (error.code) {
    case "CONFLICT":
      return error.reason === "RULE_SET_PIN_CHANGED"
        ? "قوانین این برنامه پس از پیش‌نمایش تغییر کرده است. پیش‌نمایش تازه را بررسی کنید."
        : "برنامه پس از پیش‌نمایش تغییر کرده است. پیش‌نمایش تازه را بررسی کنید و دوباره تأیید کنید.";
    case "INVALID_STATE":
    case "VALIDATION":
      return error.reason
        ? applyRefusalText(error.reason)
        : "تأیید صریح اعمال لازم است.";
    case "FORBIDDEN":
      return "فقط سوپروایزر این بخش یا مدیر بیمارستان می‌تواند قوانین برنامه را تغییر دهد.";
    case "NOT_FOUND":
      return "برنامه یا نسخه موردنظر پیدا نشد.";
    default:
      return "خطای غیرمنتظره‌ای رخ داد. لطفاً دوباره تلاش کنید.";
  }
}

/** One rule-set lifecycle event as a sentence (D110). */
export function historyEntryText(
  entry: RuleSetHistoryEntry,
  scopeName: string,
): string {
  const version = `${versionLabel(entry.versionNo)} ${scopeName}`;
  switch (entry.kind) {
    case "DRAFT_CREATED":
      return `پیش‌نویس ${version} ساخته شد.`;
    case "DRAFT_UPDATED":
      return `پیش‌نویس ${version} ویرایش شد.`;
    case "DRAFT_DISCARDED":
      return `پیش‌نویس ${version} حذف شد.`;
    case "PUBLISHED":
      return `${version} منتشر شد${entry.effectiveFrom ? `؛ اجرا از ${formatJalaliDate(entry.effectiveFrom)}` : ""}.`;
    case "RETIRED":
      return entry.retiredReason === "REPLACED"
        ? `${version} با انتشار ${entry.replacedByVersionNo ? versionLabel(entry.replacedByVersionNo) : "نسخه دیگر"} جایگزین و بازنشسته شد.`
        : `${version} کنار گذاشته شد${entry.note ? ` (${entry.note})` : ""}.`;
  }
}

/** One Apply as a sentence: who changed which schedule from what to what, and the effect. */
export function applicationEntryText(
  entry: ApplicationHistoryEntry,
  input: {
    readonly scheduleLabel: string;
    readonly from: string;
    readonly to: string;
  },
): string {
  const parts = [
    `قوانین «${input.scheduleLabel}» از ${input.from} به ${input.to} تغییر کرد${entry.rollback ? " (بازگشت به نسخه پیشین)" : ""}.`,
  ];
  if (entry.before && entry.after)
    parts.push(
      `مشکلات پوشش: ${faNumber(entry.before.coverageProblems)} ← ${faNumber(entry.after.coverageProblems)}؛ روزهای آماده: ${faNumber(entry.before.readyDays)} ← ${faNumber(entry.after.readyDays)}.`,
    );
  parts.push("شیفت‌های تغییرکرده: ۰.");
  if (entry.revisionId)
    parts.push(
      entry.addedRevisionDates.length > 0
        ? `در بازنگری؛ ${faNumber(entry.addedRevisionDates.length)} روز به دامنه بازنگری افزوده شد.`
        : "در بازنگری.",
    );
  return parts.join(" ");
}
