import type { Metadata } from "next";
import Link from "next/link";

import { getPersonnelDirectory } from "@/application/management/personnel-queries";
import { buttonClasses } from "@/components/ui/button";
import { requireRequestContext } from "@/features/auth/guards";
import { DirectoryView } from "@/features/management/directory-view";
import { managementPageRead } from "@/features/management/page-read";
import { PageHeader } from "@/features/shell/page-header";

export const metadata: Metadata = { title: "کاربران بیمارستان" };

export default async function PersonnelPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireRequestContext();
  const directory = await managementPageRead(
    getPersonnelDirectory(ctx, await searchParams),
  );
  return (
    <>
      <PageHeader
        title="کاربران بیمارستان"
        description="حساب‌ها، دسترسی جاری افراد و مدیریت عضویت بخش‌ها."
      />
      <div className="mb-5 flex flex-wrap gap-2">
        <Link href="/admin/personnel/new" className={buttonClasses()}>
          ایجاد کاربر
        </Link>
        <Link
          href="/admin/personnel/import"
          className={buttonClasses("outline")}
        >
          ورود گروهی پرسنل (CSV)
        </Link>
      </div>
      <DirectoryView directory={directory} />
    </>
  );
}
