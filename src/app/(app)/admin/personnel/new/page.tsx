import type { Metadata } from "next";
import Link from "next/link";

import { requirePersonnelReadAccess } from "@/application/management/personnel-queries";
import { buttonClasses } from "@/components/ui/button";
import { requireRequestContext } from "@/features/auth/guards";
import { CreateAccountForm } from "@/features/management/create-account-form";
import { managementPageRead } from "@/features/management/page-read";
import { PageHeader } from "@/features/shell/page-header";

export const metadata: Metadata = { title: "ایجاد کاربر" };

export default async function CreatePersonPage() {
  await managementPageRead(
    requirePersonnelReadAccess(await requireRequestContext()),
  );
  return (
    <div className="space-y-6">
      <Link href="/admin/personnel" className={buttonClasses("outline")}>
        بازگشت به کاربران بیمارستان
      </Link>
      <PageHeader
        title="ایجاد کاربر"
        description="حساب با شماره پرسنلی و نام ساخته می‌شود؛ ایمیل و موبایل اختیاری‌اند. عضویت بخش پس از ایجاد حساب جداگانه ثبت می‌شود. برای ثبت گروهی از «ورود گروهی پرسنل» استفاده کنید."
      />
      <CreateAccountForm />
    </div>
  );
}
