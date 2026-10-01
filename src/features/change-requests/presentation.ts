import type { ActionError } from "@/application/result";
import type { BadgeTone } from "@/components/ui/badge";
import type {
  ChangeRequestRejection,
  ChangeRequestStatus,
  ChangeRequestType,
  SwapConsentStatus,
} from "@/domain/change-requests/model";
import type { ShiftCode } from "@/domain/shifts/shift-type";
import { SHIFT_PRESENTATION } from "@/features/shifts/catalog";

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

const shift = (code: ShiftCode | null) =>
  code ? `شیفت ${SHIFT_PRESENTATION[code].name}` : "استراحت";

/**
 * One sentence of what was asked, from the nurse's own point of view
 * (`role`), with the shifts the request was made against.
 */
export function requestSummary(request: {
  readonly type: ChangeRequestType;
  readonly requesterShift: ShiftCode;
  readonly targetShift: ShiftCode | null;
  readonly counterpart: { readonly displayName: string } | null;
  readonly counterpartShift: ShiftCode | null;
  readonly requester: { readonly displayName: string };
  readonly role?: "REQUESTER" | "COUNTERPART";
}): string {
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
} as const;

export type RequestCommand = "create" | "cancel" | "respond" | "refresh";

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
};

const FORBIDDEN: Record<string, string> = {
  SCHEDULE_NOT_YET_FINALIZED:
    "این برنامه هنوز نهایی نشده است؛ تا آن زمان ترجیحات خود را ثبت کنید.",
  NOT_MEMBER_OF_DEPARTMENT:
    "شما عضو فعلی این بخش نیستید؛ درخواست‌های قبلی فقط قابل مشاهده‌اند.",
  NOT_REQUESTER: "فقط کسی که درخواست را ثبت کرده می‌تواند آن را تغییر دهد.",
  NOT_COUNTERPART: "فقط همکاری که نامش در درخواست آمده می‌تواند پاسخ دهد.",
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
    case "INTERNAL":
      return "خطای غیرمنتظره‌ای رخ داد. لطفاً دوباره تلاش کنید.";
  }
}
