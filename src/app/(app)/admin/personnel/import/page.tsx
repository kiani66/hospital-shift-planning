import type { Metadata } from "next";
import Link from "next/link";

import { getMembershipFormOptions } from "@/application/management/personnel-queries";
import { buttonClasses } from "@/components/ui/button";
import { requireRequestContext } from "@/features/auth/guards";
import { managementPageRead } from "@/features/management/page-read";
import { ImportWizard } from "@/features/personnel-import/import-wizard";
import { IMPORT_FIELD_LABELS } from "@/features/personnel-import/presentation";
import { PageHeader } from "@/features/shell/page-header";

export const metadata: Metadata = { title: "ورود گروهی پرسنل" };

const COLUMNS = [
  [
    "personnelNumber",
    "personnel_number",
    "الزامی؛ فقط رقم. صفرهای ابتدایی حفظ می‌شوند.",
  ],
  ["displayName", "display_name", "الزامی"],
  ["email", "email", "اختیاری؛ غیرتکراری"],
  ["mobile", "mobile", "اختیاری؛ مثل ۰۹۱۲۱۲۳۴۵۶۷"],
  ["role", "role", "اختیاری؛ «پرستار» (پیش‌فرض) یا «سرپرستار»"],
] as const;

/** Hospital Admin only; every action authorizes again on the server. */
export default async function PersonnelImportPage() {
  const ctx = await requireRequestContext();
  const options = await managementPageRead(getMembershipFormOptions(ctx));
  return (
    <div className="space-y-6">
      <Link href="/admin/personnel" className={buttonClasses("outline")}>
        بازگشت به کاربران بیمارستان
      </Link>
      <PageHeader
        title="ورود گروهی پرسنل"
        description="فایل CSV خروجی Excel را بارگذاری کنید. همه ردیف‌ها پیش از ثبت بررسی و پیش‌نمایش می‌شوند و ثبت فقط پس از تأیید شما و به‌صورت همه‌یا‌هیچ انجام می‌شود."
      />
      <details className="max-w-3xl rounded-xl border bg-card p-4 text-sm leading-relaxed">
        <summary className="cursor-pointer font-semibold">
          راهنمای ستون‌ها و قالب فایل
        </summary>
        <div className="mt-3 space-y-3">
          <p>
            سطر اول سرستون‌هاست. سرستون فارسی یا انگلیسی پذیرفته است؛ ستون‌های
            دیگر (مثل ردیف) نادیده گرفته و در پیش‌نمایش اعلام می‌شوند.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-start">
                  <th scope="col" className="py-1 text-start">
                    سرستون فارسی
                  </th>
                  <th scope="col" className="py-1 text-start">
                    انگلیسی
                  </th>
                  <th scope="col" className="py-1 text-start">
                    توضیح
                  </th>
                </tr>
              </thead>
              <tbody>
                {COLUMNS.map(([field, english, note]) => (
                  <tr key={field} className="border-t">
                    <td className="py-1">{IMPORT_FIELD_LABELS[field]}</td>
                    <td className="py-1 font-mono" dir="ltr">
                      {english}
                    </td>
                    <td className="py-1">{note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="list-disc space-y-1 ps-5">
            <li>
              در Excel با «Save As → CSV UTF-8» ذخیره کنید. جداکننده ویرگول،
              نقطه‌ویرگول یا «؛» شناخته می‌شود.
            </li>
            <li>
              پیش از وارد کردن شماره‌های پرسنلی، قالب آن ستون را «Text» کنید تا
              Excel صفرهای ابتدایی را حذف نکند.
            </li>
            <li>
              افراد فقط با شماره پرسنلی تطبیق داده می‌شوند. اطلاعات حساب‌های
              موجود هرگز بازنویسی نمی‌شود؛ هر اختلاف به‌صورت خطا نمایش داده
              می‌شود.
            </li>
            <li>
              رمز عبور هرگز در فایل نیست. حساب‌های جدید بدون رمز ساخته می‌شوند و
              پس از ثبت می‌توانید برایشان رمز موقت یک‌بارمصرف بسازید.
            </li>
            <li>
              ورود گروهی افراد را به برنامه‌های موجود اضافه نمی‌کند؛ سرپرستار
              این کار را از صفحه برنامه بخش انجام می‌دهد.
            </li>
          </ul>
        </div>
      </details>
      <ImportWizard departments={options.departments} today={options.today} />
    </div>
  );
}
