import type { Metadata } from "next";

import { requireDepartmentPage } from "@/features/shell/department-page";
import { NotYetImplemented, PageHeader } from "@/features/shell/page-header";

export const metadata: Metadata = { title: "برنامه بخش" };

/** Head Nurse of this department only (`department.manage`). */
export default async function DepartmentSchedulePage({
  params,
}: PageProps<"/departments/[code]/schedule">) {
  const department = await requireDepartmentPage(params, "department.manage");
  return (
    <>
      <PageHeader
        title={`برنامه بخش — ${department.name}`}
        description="ایجاد و تنظیم برنامه ماهانه شیفت‌های بخش."
      />
      <NotYetImplemented plannedFor="در فاز برنامه‌ریزی" />
    </>
  );
}
