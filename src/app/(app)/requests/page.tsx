import type { Metadata } from "next";

import { requireRequestContext } from "@/features/auth/guards";
import { NotYetImplemented, PageHeader } from "@/features/shell/page-header";

export const metadata: Metadata = { title: "درخواست‌ها" };

export default async function RequestsPage() {
  await requireRequestContext();
  return (
    <>
      <PageHeader
        title="درخواست‌ها"
        description="درخواست‌های تغییر شیفت شما و درخواست‌هایی که باید بررسی کنید."
      />
      <NotYetImplemented plannedFor="در فاز درخواست تغییر شیفت" />
    </>
  );
}
