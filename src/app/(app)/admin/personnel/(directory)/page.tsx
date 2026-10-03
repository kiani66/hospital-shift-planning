import type { Metadata } from "next";

import { getPersonnelDirectory } from "@/application/management/personnel-queries";
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
        description="مشاهده حساب‌ها و دسترسی جاری افراد؛ فقط خواندنی."
      />
      <DirectoryView directory={directory} />
    </>
  );
}
