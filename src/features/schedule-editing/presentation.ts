import type { ActionError } from "@/application/result";
import type { PreferenceFit } from "@/domain/preferences/preference-fit";
import type {
  AssignmentChange,
  AssignmentEditDenial,
} from "@/domain/schedule/assignment-editing";
import { ASSIGNMENT_EDIT_REFUSALS } from "@/domain/schedule/assignment-editing";
import type { ShiftCode } from "@/domain/shifts/shift-type";
import { faNumber } from "@/features/calendar/jalali";
import { SHIFT_PRESENTATION } from "@/features/shifts/catalog";

/**
 * Wording of the Head Nurse's assignment editing. Pure: the server action
 * and the client editor both use it, and the unit tests pin it. Business
 * states come in (error codes, denial reasons, preference fit); Persian
 * text goes out. Rule codes and raw database errors never reach the user.
 */

/** What kind of failure an edit had; the editor words and reacts per kind. */
export type EditFailureKind =
  "FORBIDDEN" | "INVALID" | "CONFLICT" | "LOCKED" | "SERVER";

export interface EditFailure {
  readonly kind: EditFailureKind;
  readonly message: string;
}

const NOTHING_SAVED = "تغییری ثبت نشد.";

export function editFailure(error: ActionError): EditFailure {
  switch (error.code) {
    case "FORBIDDEN":
    case "NOT_FOUND":
      return {
        kind: "FORBIDDEN",
        message: `اجازه ویرایش این برنامه را ندارید یا برنامه دیگر در دسترس نیست. ${NOTHING_SAVED}`,
      };
    case "VALIDATION":
      return {
        kind: "INVALID",
        message: error.fieldErrors?.nurseId
          ? `این فرد در فهرست پرسنل این برنامه نیست. ${NOTHING_SAVED}`
          : error.fieldErrors?.date
            ? `این روز در دوره این برنامه نیست. ${NOTHING_SAVED}`
            : `درخواست تغییر معتبر نبود. ${NOTHING_SAVED}`,
      };
    case "CONFLICT":
      return {
        kind: "CONFLICT",
        message: `برنامه در این فاصله در جای دیگری (زبانه یا کاربر دیگر) تغییر کرد و آخرین وضعیت نمایش داده شد. ${NOTHING_SAVED} در صورت نیاز دوباره اعمال کنید.`,
      };
    case "INVALID_STATE":
      return {
        kind: "LOCKED",
        message:
          error.reason === ASSIGNMENT_EDIT_REFUSALS.DATE_OUTSIDE_REVISION_SCOPE
            ? `این روز در محدوده بازنگری برنامه نیست و شیفت‌های آن قابل تغییر نیست. ${NOTHING_SAVED}`
            : `برنامه در وضعیت فعلی قفل است و شیفت‌ها قابل تغییر نیستند. ${NOTHING_SAVED}`,
      };
    default:
      return {
        kind: "SERVER",
        message: `ثبت تغییر به دلیل خطای سرور ممکن نشد. ${NOTHING_SAVED} دوباره تلاش کنید.`,
      };
  }
}

/** The request never got an answer (offline, timeout, server down). */
export const NETWORK_FAILURE: EditFailure = {
  kind: "SERVER",
  message: `ارتباط با سرور برقرار نشد. ${NOTHING_SAVED} دوباره تلاش کنید.`,
};

/** The id of a nurse's row in the day editor; findings link to it. */
export const nurseRowId = (userId: string) => `nurse-${userId}`;

/** "صبح (M)", or "بدون شیفت". */
export const shiftWord = (shift: ShiftCode | null) =>
  shift === null ? "بدون شیفت" : `${SHIFT_PRESENTATION[shift].name} (${shift})`;

/**
 * One sentence for a saved edit. `names` maps nurse ids to display names;
 * `dayLabel` names the day when the edit is on one day.
 */
export function savedMessage(
  changes: readonly AssignmentChange[],
  names: ReadonlyMap<string, string>,
  dayLabel: (date: string) => string,
  undo = false,
): string {
  if (changes.length === 0) return "تغییری لازم نبود؛ همین مقدار ثبت شده بود.";
  if (undo)
    return `آخرین تغییر بازگردانده شد (${faNumber(changes.length)} مورد).`;
  const [first] = changes;
  const name = `«${names.get(first!.nurseId) ?? "—"}»`;
  if (changes.length === 1)
    return first!.after === null
      ? `شیفت ${name} در ${dayLabel(first!.date)} پاک شد؛ در فهرست پرسنل می‌ماند.`
      : `${shiftWord(first!.after)} برای ${name} در ${dayLabel(first!.date)} ثبت شد.`;
  const after = first!.after;
  const sameValue = changes.every((c) => c.after === after);
  return sameValue
    ? `${shiftWord(after)} برای ${name} در ${faNumber(changes.length)} روز ثبت شد.`
    : `${faNumber(changes.length)} تغییر ثبت شد.`;
}

/** Why a day cannot be edited, in words (the editor is not shown then). */
export function editDenialLabel(
  reason: AssignmentEditDenial | "NOT_AUTHORIZED",
): string {
  switch (reason) {
    case "SCHEDULE_LOCKED":
      return "برنامه در وضعیت فعلی قفل است؛ شیفت‌ها فقط قابل مشاهده‌اند.";
    case "DATE_OUTSIDE_REVISION_SCOPE":
      return "این روز در محدوده بازنگری برنامه نیست؛ فقط قابل مشاهده است.";
    case "DATE_OUTSIDE_PERIOD":
      return "این روز در دوره برنامه نیست.";
    case "NOT_AUTHORIZED":
      return "شما اجازه ویرایش شیفت‌های این برنامه را ندارید.";
  }
}

/**
 * The preference beside a nurse's shift. A wish is context, never an
 * assignment and never an error (D35): DIFFERS is a neutral note.
 */
export function preferenceFitLabel(fit: PreferenceFit): string | null {
  switch (fit) {
    case "NONE":
    case "PENDING":
      return null;
    case "MATCHES":
      return "مطابق ترجیح";
    case "DIFFERS":
      return "متفاوت با ترجیح";
  }
}
