import type { ImportFileError } from "@/application/personnel-import/rows";
import type {
  ImportAction,
  ImportField,
  ImportRowError,
} from "@/domain/management/personnel-import";

export const IMPORT_ACTION_LABELS: Record<ImportAction, string> = {
  CREATE: "ایجاد حساب و عضویت",
  ADD_MEMBERSHIP: "افزودن عضویت برای حساب موجود",
  UNCHANGED: "بدون تغییر (قبلاً ثبت شده)",
  ERROR: "خطا",
};

export const IMPORT_FIELD_LABELS: Record<ImportField, string> = {
  personnelNumber: "شماره پرسنلی",
  displayName: "نام و نام خانوادگی",
  email: "ایمیل",
  mobile: "موبایل",
  role: "نقش",
};

export const IMPORT_ROW_ERRORS: Record<ImportRowError, string> = {
  PERSONNEL_NUMBER_REQUIRED: "شماره پرسنلی خالی است.",
  PERSONNEL_NUMBER_INVALID:
    "شماره پرسنلی باید فقط ۱ تا ۲۰ رقم باشد (بدون فاصله، خط تیره یا اعشار).",
  DISPLAY_NAME_REQUIRED: "نام و نام خانوادگی خالی است.",
  DISPLAY_NAME_TOO_LONG: "نام بیش از ۲۰۰ نویسه است.",
  EMAIL_INVALID: "ایمیل معتبر نیست.",
  MOBILE_INVALID: "شماره موبایل معتبر ایران نیست.",
  ROLE_INVALID: "نقش باید «پرستار» یا «سرپرستار» (یا خالی) باشد.",
  EXTRA_CELLS: "این ردیف خانه‌های بیشتری از سرستون‌ها دارد.",
  DUPLICATE_PERSONNEL_NUMBER_IN_FILE:
    "این شماره پرسنلی بیش از یک بار در فایل آمده است.",
  DUPLICATE_EMAIL_IN_FILE: "این ایمیل بیش از یک بار در فایل آمده است.",
  EMAIL_TAKEN:
    "این ایمیل متعلق به حساب دیگری است. حساب‌ها فقط با شماره پرسنلی تطبیق داده می‌شوند.",
  IDENTITY_CONFLICT:
    "اطلاعات این ردیف با حساب ثبت‌شده با همین شماره پرسنلی متفاوت است؛ اطلاعات موجود بازنویسی نمی‌شود.",
  ACCOUNT_INACTIVE:
    "حساب این شماره پرسنلی غیرفعال است؛ ورود گروهی حساب را فعال نمی‌کند.",
  ROLE_CONFLICT: "این فرد در این بخش عضویت جاری یا آینده با نقش دیگری دارد.",
  MEMBERSHIP_DATES_CONFLICT:
    "این فرد در این بخش عضویتی با تاریخ‌های متفاوت (شروع بعدی یا پایان مشخص) دارد.",
};

export const IMPORT_FILE_ERRORS: Record<ImportFileError, string> = {
  EMPTY_FILE: "فایل خالی است.",
  UNTERMINATED_QUOTE: "ساختار CSV معتبر نیست (یک علامت نقل‌قول بسته نشده است).",
  NOT_UTF8:
    "فایل با کدگذاری UTF-8 ذخیره نشده است. در Excel گزینه «CSV UTF-8» را انتخاب کنید.",
  TOO_LARGE: "حجم فایل بیش از ۲۵۶ کیلوبایت است.",
  TOO_MANY_ROWS:
    "فایل بیش از ۵۰۰ ردیف داده دارد؛ آن را به چند فایل تقسیم کنید.",
  NO_DATA_ROWS: "فایل جز سرستون ردیفی ندارد.",
  MISSING_REQUIRED_COLUMN: "ستون الزامی در فایل نیست:",
  DUPLICATE_COLUMN: "یک ستون بیش از یک بار آمده است:",
  CREDENTIAL_COLUMN:
    "فایل ستونی شبیه رمز عبور دارد. رمز عبور هرگز نباید در فایل باشد؛ آن ستون را حذف کنید.",
};
