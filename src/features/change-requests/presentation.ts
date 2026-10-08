import type { ActionError } from "@/application/result";
import type { BadgeTone } from "@/components/ui/badge";
import type {
  ChangeRequestRejection,
  ChangeRequestStatus,
  ChangeRequestType,
  SwapConsentStatus,
} from "@/domain/change-requests/model";
import {
  isWorkingShift,
  type AssignmentCode,
  type ShiftCode,
} from "@/domain/shifts/shift-type";
import type { ShiftLabels } from "@/features/shifts/catalog";

/**
 * Persian wording of Shift Change Requests (Phase 9). The server decides;
 * this only explains its answers: stable codes and reasons in, sentences
 * out. Nothing here shows a raw code or a technical message.
 */

/** Short names (badges, list titles). */
export const REQUEST_TYPE_LABELS: Record<ChangeRequestType, string> = {
  UNAVAILABLE: "عدم امکان حضور",
  CHANGE_SHIFT: "تغییر شیفت",
  SWAP: "جابه‌جایی با همکار",
  OTHER: "سایر",
};

/** What each type asks for (the type picker's descriptions). */
export const REQUEST_TYPE_DESCRIPTIONS: Record<ChangeRequestType, string> = {
  UNAVAILABLE: "نمی‌توانم شیفت این روز را کار کنم.",
  CHANGE_SHIFT: "در همین روز، شیفت دیگری می‌خواهم.",
  SWAP: "شیفت این روز را با همکاری جابه‌جا کنم؛ موافقت او لازم است.",
  OTHER: "درخواست دیگری دارم؛ در توضیح بنویسید.",
};

export const REQUEST_STATUS: Record<
  ChangeRequestStatus,
  { readonly label: string; readonly tone: BadgeTone }
> = {
  PENDING: { label: "در انتظار بررسی", tone: "review" },
  APPLIED: { label: "اعمال شد", tone: "success" },
  REJECTED: { label: "رد شد", tone: "destructive" },
  CANCELLED: { label: "لغو شد", tone: "muted" },
};

export const CONSENT_STATUS: Record<
  SwapConsentStatus,
  { readonly label: string; readonly tone: BadgeTone }
> = {
  PENDING: { label: "در انتظار موافقت همکار", tone: "warning" },
  ACCEPTED: { label: "همکار موافقت کرد", tone: "info" },
  DECLINED: { label: "همکار موافقت نکرد", tone: "muted" },
};

/** Who closed a rejected request, as the nurse reads it. */
export const REJECTION_LABELS: Record<ChangeRequestRejection, string> = {
  HEAD_NURSE: "سرپرستار درخواست را رد کرد.",
  COUNTERPART_DECLINED: "همکار با جابه‌جایی موافقت نکرد.",
};

/**
 * A decision inside a sentence: "شیفت صبح" for a working shift, the bare
 * label for one without hours (OFF, "استراحت"), or "تعیین‌نشده".
 */
export const decisionPhrase = (
  code: AssignmentCode | null,
  labels: ShiftLabels,
) =>
  code === null
    ? "تعیین‌نشده"
    : isWorkingShift(code)
      ? `شیفت ${labels[code]}`
      : labels[code];

/**
 * One sentence of what was asked, from the nurse's own point of view
 * (`role`), with the shifts the request was made against.
 */
export function requestSummary(
  request: {
    readonly type: ChangeRequestType;
    readonly requesterShift: AssignmentCode;
    readonly targetShift: ShiftCode | null;
    readonly counterpart: { readonly displayName: string } | null;
    readonly counterpartShift: AssignmentCode | null;
    readonly requester: { readonly displayName: string };
    readonly role?: "REQUESTER" | "COUNTERPART";
  },
  labels: ShiftLabels,
): string {
  const shift = (code: AssignmentCode | null) => decisionPhrase(code, labels);
  const mine = shift(request.requesterShift);
  switch (request.type) {
    case "UNAVAILABLE":
      return `امکان حضور در ${mine} را ندارد.`;
    case "CHANGE_SHIFT":
      return `${mine} به ${shift(request.targetShift)} تغییر کند.`;
    case "SWAP":
      return request.role === "COUNTERPART"
        ? `«${request.requester.displayName}» می‌خواهد ${mine} خود را با ${shift(request.counterpartShift)} شما جابه‌جا کند.`
        : `${mine} با ${shift(request.counterpartShift)} «${request.counterpart?.displayName ?? "همکار"}» جابه‌جا شود.`;
    case "OTHER":
      return `درباره ${mine}؛ جزئیات در توضیح آمده است.`;
  }
}

/** What became of an applied request's change (APPLIED never says "in effect" alone). */
export const APPLIED_STATE: Record<
  "WORKING_COPY" | "PENDING_REVISION" | "APPROVED" | "DISCARDED",
  {
    readonly label: string;
    readonly description: string;
    readonly tone: BadgeTone;
  }
> = {
  WORKING_COPY: {
    label: "در انتظار تأیید برنامه",
    description:
      "تغییر در برنامه کاری اعمال شده و با تأیید برنامه اجرایی می‌شود.",
    tone: "review",
  },
  PENDING_REVISION: {
    label: "در بازنگری، در انتظار تأیید",
    description:
      "تغییر در بازنگری برنامه تأییدشده است؛ تا تأیید سوپروایزر، نسخه تأییدشده قبلی اجرایی است.",
    tone: "warning",
  },
  APPROVED: {
    label: "بخشی از تأیید سوپروایزر",
    description:
      "این تغییر بخشی از برنامه یا بازنگری‌ای بود که سوپروایزر تأیید کرد. شیفت همین روز ممکن است پس از آن دوباره تغییر کرده باشد؛ برنامه اجرایی را در آخرین نسخه تأییدشده ببینید.",
    tone: "success",
  },
  DISCARDED: {
    label: "بازنگری کنار گذاشته شد",
    description:
      "بازنگری‌ای که این تغییر در آن بود کنار گذاشته شد؛ تغییر در برنامه اجرایی نیست. سابقه درخواست و تغییر حفظ شده است.",
    tone: "destructive",
  },
};

/** Where a change goes, in the Head Nurse's words. */
export const CHANGE_MODE_LABELS = {
  WORKING_COPY: "در برنامه کاری (هنوز تأیید نشده) اعمال می‌شود.",
  START_REVISION:
    "برنامه تأیید شده است: بازنگری جدیدی برای این روز باز می‌شود؛ نسخه تأییدشده دست نمی‌خورد و تغییر پس از ارسال و تأیید سوپروایزر اجرایی می‌شود.",
  EXTEND_REVISION:
    "به بازنگری باز این برنامه افزوده می‌شود؛ پس از ارسال و تأیید سوپروایزر اجرایی می‌شود.",
} as const;

export const REQUEST_SUCCESS = {
  create: "درخواست ثبت شد و برای سرپرستار ارسال شد.",
  createSwap:
    "درخواست ثبت شد؛ همکار باید موافقت کند و سپس سرپرستار آن را بررسی می‌کند.",
  cancel: "درخواست لغو شد.",
  accept: "موافقت شما ثبت شد؛ تصمیم نهایی با سرپرستار است.",
  decline: "مخالفت شما ثبت شد و درخواست بسته شد.",
  refresh:
    "درخواست با شیفت‌های فعلی به‌روز شد و دوباره از همکار موافقت خواسته شد.",
  refreshUnchanged: "شیفت‌ها تغییری نکرده‌اند؛ درخواست همان است که بود.",
  apply: "درخواست اعمال شد و به پرستار اطلاع داده شد.",
  reject: "درخواست رد شد و به پرستار اطلاع داده شد.",
  adjust: "تغییر عملیاتی ثبت شد.",
} as const;

export type RequestCommand =
  "create" | "cancel" | "respond" | "refresh" | "apply" | "reject" | "adjust";

/** Persian messages for the form's fields (`fieldErrors` keys from the server). */
export const FIELD_MESSAGES: Record<string, string> = {
  date: "این روز قابل درخواست نیست: یا گذشته است، یا در آن شیفتی ندارید.",
  type: "نوع درخواست را انتخاب کنید.",
  targetShift: "شیفتی متفاوت با شیفت فعلی خود انتخاب کنید.",
  counterpartId:
    "همکاری از همین برنامه انتخاب کنید که در این روز شیفت متفاوتی دارد.",
  reasonCode: "علت را از فهرست انتخاب کنید.",
  note: "برای این علت توضیح لازم است (حداکثر ۵۰۰ نویسه).",
  requesterId: "شما در فهرست افراد این برنامه نیستید.",
  replacementNurseId:
    "جانشین باید از افراد همین برنامه باشد و در این روز شیفت نداشته باشد.",
  requesterShift: "شیفت نهایی درخواست‌دهنده را انتخاب کنید.",
  changes: "این تغییر چیزی را عوض نمی‌کند یا پرستار در فهرست این برنامه نیست.",
  request: "برنامه هم‌اکنون همین وضعیت را دارد؛ اعمال، چیزی را تغییر نمی‌دهد.",
  nurseId: "پرستار باید از افراد همین برنامه باشد.",
};

/** Per-field messages for an error that carries `fieldErrors`. */
export function fieldMessages(error: ActionError): Record<string, string> {
  return Object.fromEntries(
    Object.keys(error.fieldErrors ?? {}).map((field) => [
      field,
      FIELD_MESSAGES[field] ?? "این مقدار معتبر نیست.",
    ]),
  );
}

const INVALID_STATE: Record<string, string> = {
  CREATE_CHANGE_REQUEST:
    "این برنامه هنوز نهایی نشده است؛ تا آن زمان ترجیحات خود را ثبت کنید.",
  SWAP_CONTEXT_CHANGED:
    "شیفت یکی از شما در این روز تغییر کرده است؛ درخواست‌دهنده باید درخواست را با شیفت‌های فعلی به‌روز کند.",
  SWAP_CONSENT_ALREADY_ANSWERED: "به این درخواست قبلاً پاسخ داده شده است.",
  SWAP_ONLY: "این کار فقط برای درخواست جابه‌جایی است.",
  APPLY_SWAP_WITHOUT_CONSENT:
    "بدون موافقت همکار نمی‌توان جابه‌جایی را اعمال کرد.",
  STALE_CONTEXT_NOT_CONFIRMED:
    "شیفت پرستار پس از ثبت درخواست تغییر کرده است؛ برای اعمال بر اساس شیفت فعلی، آن را تأیید کنید.",
  CHANGE_WHILE_SUBMITTED:
    "برنامه برای تأیید سوپروایزر ارسال شده و قفل است؛ برای تغییر، ابتدا ارسال را پس بگیرید.",
  CHANGE_BEFORE_FINALIZATION:
    "برنامه هنوز نهایی نشده است؛ شیفت‌ها را از صفحه برنامه ویرایش کنید.",
  CHANGE_WITHOUT_REVISION: "بازنگری بازی برای این برنامه پیدا نشد.",
  EDIT_ASSIGNMENT: "شیفت‌های این برنامه در وضعیت فعلی قابل تغییر نیست.",
  EDIT_ASSIGNMENT_OUTSIDE_REVISION_SCOPE: "این روز خارج از محدوده بازنگری است.",
};

const FORBIDDEN: Record<string, string> = {
  SCHEDULE_NOT_YET_FINALIZED:
    "این برنامه هنوز نهایی نشده است؛ تا آن زمان ترجیحات خود را ثبت کنید.",
  NOT_MEMBER_OF_DEPARTMENT:
    "شما عضو فعلی این بخش نیستید؛ درخواست‌های قبلی فقط قابل مشاهده‌اند.",
  NOT_REQUESTER: "فقط کسی که درخواست را ثبت کرده می‌تواند آن را تغییر دهد.",
  NOT_COUNTERPART: "فقط همکاری که نامش در درخواست آمده می‌تواند پاسخ دهد.",
  NOT_HEAD_NURSE_OF_DEPARTMENT:
    "فقط سرپرستار همین بخش می‌تواند این کار را انجام دهد.",
};

/** A refused command, in Persian. */
export function requestErrorMessage(
  command: RequestCommand,
  error: ActionError,
): string {
  switch (error.code) {
    case "VALIDATION":
      return error.fieldErrors
        ? "لطفاً موارد مشخص‌شده را اصلاح کنید."
        : "اطلاعات واردشده معتبر نیست.";
    case "FORBIDDEN":
      return (
        (error.reason && FORBIDDEN[error.reason]) ??
        "شما اجازه انجام این کار را ندارید."
      );
    case "NOT_FOUND":
      return command === "create"
        ? "برنامه موردنظر پیدا نشد."
        : "این درخواست پیدا نشد.";
    case "CONFLICT":
      return error.reason === "DUPLICATE_ACTIVE_REQUEST"
        ? "برای این روز یک درخواست فعال دارید؛ اگر می‌خواهید چیز دیگری بخواهید، ابتدا آن را لغو کنید."
        : "این درخواست در این فاصله تغییر کرده است؛ صفحه به‌روز شد.";
    case "INVALID_STATE":
      return (
        (error.reason && INVALID_STATE[error.reason]) ??
        "این درخواست دیگر در انتظار نیست و قابل تغییر نیست."
      );
    case "RULE_VIOLATION":
      return command === "apply" || command === "adjust"
        ? "این تغییر یک قانون مسدودکننده را نقض می‌کند و اعمال نشد؛ جزئیات را در بررسی ببینید."
        : "خطای غیرمنتظره‌ای رخ داد. لطفاً دوباره تلاش کنید.";
    case "INTERNAL":
      return "خطای غیرمنتظره‌ای رخ داد. لطفاً دوباره تلاش کنید.";
  }
}
