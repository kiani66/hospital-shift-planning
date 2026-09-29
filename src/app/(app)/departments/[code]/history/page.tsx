import type { Metadata } from "next";

import { requireDepartmentPage } from "@/features/shell/department-page";
import { NotYetImplemented, PageHeader } from "@/features/shell/page-header";

export const metadata: Metadata = { title: "تاریخچه" };

/** Head Nurse or supervisor of this department (`audit.view`). */
export default async function DepartmentHistoryPage({
  params,
}: PageProps<"/departments/[code]/history">) {
  const department = await requireDepartmentPage(params, "audit.view");
  return (
    <>
      <PageHeader
        title={`تاریخچه — ${department.name}`}
        description="نسخه‌های تأییدشده و رویدادهای ثبت‌شده برنامه‌های بخش."
      />
      <NotYetImplemented plannedFor="در فاز تاریخچه و بازبینی" />
    </>
  );
}
