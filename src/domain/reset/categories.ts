/** Product categories, never user-supplied table names. Tables verified against migrations 0000–0012. */
export const RESET_CATEGORIES = {
  schedules: {
    label: "برنامه‌ها و داده‌های اولیه",
    description:
      "برنامه، فهرست ماهانه، پنجره ترجیحات، ارسال‌ها و نسخه‌های تأییدشده حذف می‌شوند.",
    master: false,
    global: false,
    tables: [
      "schedules",
      "schedule_roster",
      "preference_windows",
      "preference_window_dates",
      "preference_window_nurses",
      "schedule_submissions",
      "schedule_versions",
      "schedule_version_assignments",
      "schedule_revisions",
      "schedule_revision_dates",
      "schedule_rule_set_applications",
    ],
  },
  assignments: {
    label: "شیفت‌های ثبت‌شده",
    description: "همه تصمیم‌ها، از جمله OFF و پیش‌چینش، حذف می‌شوند.",
    master: false,
    global: false,
    tables: ["shift_assignments"],
  },
  preferences: {
    label: "ترجیحات پرستاران",
    description: "خواسته‌های ثبت‌شده پرستاران حذف می‌شوند.",
    master: false,
    global: false,
    tables: ["nurse_preferences"],
  },
  requests: {
    label: "درخواست‌ها",
    description: "درخواست‌های تغییر شیفت و داده‌های قدیمی وابسته حذف می‌شوند.",
    master: false,
    global: false,
    tables: [
      "shift_change_requests",
      "legacy_shift_change_requests",
      "legacy_shift_change_request_items",
    ],
  },
  planningChanges: {
    label: "تغییرات و دلایل چیدمان",
    description: "تغییرات عملیاتی، جابه‌جایی‌ها و سلول‌های وابسته حذف می‌شوند.",
    master: false,
    global: false,
    tables: ["schedule_changes", "schedule_change_cells"],
  },
  memberships: {
    label: "عضویت و نظارت بخش",
    description:
      "عضویت‌ها و انتساب‌های نظارت حذف می‌شوند؛ دسترسی بخش تغییر می‌کند.",
    master: false,
    global: false,
    tables: ["department_memberships", "supervisor_assignments"],
  },
  personnel: {
    label: "حساب‌های پرسنل",
    description:
      "حساب‌های بدون وابستگی باقی‌مانده حذف می‌شوند؛ مدیر محافظت‌شده و افراد مشترک باقی می‌مانند.",
    master: false,
    global: false,
    tables: ["users"],
  },
  notifications: {
    label: "اعلان‌ها",
    description: "اعلان‌های داخل دامنه حذف می‌شوند.",
    master: false,
    global: false,
    tables: ["notifications"],
  },
  operationalAudit: {
    label: "تاریخچه عملیاتی",
    description:
      "استثنای بازنشانی آزمایشی: تاریخچه داخل دامنه حذف می‌شود؛ سابقه مستقل بازنشانی باقی می‌ماند.",
    master: false,
    global: false,
    tables: ["audit_events"],
  },
  departments: {
    label: "بخش‌ها",
    description:
      "بخش و عضویت‌های وابسته حذف می‌شوند؛ با صفر بخش، برنامه‌ریزی، ورود CSV و دسترسی سرپرستار تا ایجاد بخش فعال و عضویت معتبر در دسترس نیست. مدیر همچنان به مدیریت و بازیابی دسترسی دارد. بخش فقط با نام و کد تأییدشده توسط اپراتور ایجاد می‌شود.",
    master: true,
    global: false,
    tables: ["departments"],
  },
  shiftTypes: {
    label: "تعریف شیفت‌ها — سراسری",
    description:
      "بدون تعریف شیفت، تقویم برنامه، ترجیحات، شیفت‌های من و درخواست‌ها نمایش عملیاتی ندارند و ثبت شیفت ممکن نیست. بازیابی کنترل‌شده تعریف‌های پیش‌فرض موجود سامانه را برمی‌گرداند.",
    master: true,
    global: true,
    tables: ["shift_types"],
  },
  changeReasons: {
    label: "دلایل تغییر — سراسری",
    description:
      "بدون دلایل فعال، ثبت درخواست و اصلاح یا جابه‌جایی دارای دلیل ممکن نیست. بازیابی کنترل‌شده دلایل پیش‌فرض را اضافه می‌کند؛ دلیل سفارشی بازگردانده نمی‌شود.",
    master: true,
    global: true,
    tables: ["change_reasons"],
  },
  departmentStaffingRules: {
    label: "قوانین پوشش بخش‌ها",
    description:
      "قانون اختصاصی و استثناهای پوشش بخش حذف می‌شوند؛ برنامه جدید از قانون منتشرشده بیمارستان استفاده می‌کند و اگر قانون قابل اعمال نباشد ایجاد برنامه متوقف می‌شود. قوانین اختصاصی باید با مقادیر تأییدشده در فرم قوانین پوشش بخش ساخته و منتشر شوند.",
    master: true,
    global: false,
    tables: [
      "staffing_rule_sets",
      "staffing_rule_set_versions",
      "staffing_rule_set_requirements",
      "staffing_rule_set_date_exceptions",
    ],
  },
  hospitalStaffingRules: {
    label: "قوانین پوشش بیمارستان — سراسری",
    description:
      "بدون قانون منتشرشده قابل اعمال، ایجاد برنامه و محاسبه پوشش ممکن نیست. بازیابی کنترل‌شده فقط خط پایه پیشین سامانه (حداقل یک نفر در M/E/N، بدون حداکثر) را برای تبار خالی بازمی‌گرداند؛ نیاز بالینی بیمارستان باید در فرم قوانین پوشش بررسی و منتشر شود.",
    master: true,
    global: true,
    tables: [
      "staffing_rule_sets",
      "staffing_rule_set_versions",
      "staffing_rule_set_requirements",
      "staffing_rule_set_date_exceptions",
    ],
  },
} as const;
export type ResetCategory = keyof typeof RESET_CATEGORIES;
export const CATEGORY_IDS = Object.keys(RESET_CATEGORIES) as ResetCategory[];
export const FULL_OPERATIONAL_CATEGORIES = CATEGORY_IDS.filter(
  (id) => !RESET_CATEGORIES[id].master,
);
export type ResetScope =
  | { kind: "APPLICATION" }
  | { kind: "DEPARTMENTS"; departmentIds: readonly string[] };
export type ResetRow = Readonly<Record<string, unknown>>;
export interface ResetForeignKey {
  columns: readonly string[];
  target: string;
  targetColumns: readonly string[];
}
export interface ResetTable {
  name: string;
  primaryKey: readonly string[];
  foreignKeys: readonly ResetForeignKey[];
  rows: readonly ResetRow[];
}
export function rowKey(table: ResetTable, row: ResetRow): string {
  return JSON.stringify(table.primaryKey.map((c) => row[c]));
}
export function references(
  child: ResetRow,
  fk: ResetForeignKey,
  parent: ResetRow,
): boolean {
  return fk.columns.every(
    (c, i) => child[c] != null && child[c] === parent[fk.targetColumns[i]!],
  );
}
