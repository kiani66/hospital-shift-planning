import { FileSpreadsheet } from "lucide-react";
import type { Metadata } from "next";

import { getExcelTemplateSettings } from "@/application/excel-export/templates";
import { SectionHeader } from "@/components/ui/section-header";
import { requireRequestContext } from "@/features/auth/guards";
import { formatJalaliDateTime } from "@/features/calendar/jalali";
import { ExcelTemplateManager } from "@/features/excel-export/template-manager";
import { requireDepartmentPage } from "@/features/shell/department-page";
import { PageHeader } from "@/features/shell/page-header";
import { APP_TIMEZONE } from "@/infrastructure/auth/actor";

export const metadata: Metadata = { title: "تنظیمات بخش" };

/**
 * Department settings: «قالب خروجی اکسل» (D124). A Hospital Admin (any
 * department) or the department's Head Nurse (`excelTemplate.manage`);
 * anyone else gets a 404. The use cases authorize again.
 */
export default async function DepartmentSettingsPage({
  params,
}: PageProps<"/departments/[code]/settings">) {
  const department = await requireDepartmentPage(
    params,
    "excelTemplate.manage",
  );
  const ctx = await requireRequestContext();
  const { template } = await getExcelTemplateSettings(ctx, {
    departmentId: department.id,
  });
  return (
    <>
      <PageHeader title={`تنظیمات بخش — ${department.name}`} />
      <section aria-labelledby="excel-template" className="flex flex-col gap-4">
        <SectionHeader
          id="excel-template"
          title="قالب خروجی اکسل"
          icon={<FileSpreadsheet aria-hidden className="size-4" />}
        />
        <p className="text-sm leading-relaxed text-muted-foreground">
          برنامه ماهانه در همین فایل Excel بیمارستان نوشته می‌شود: فقط خانه‌های
          ۳۱ روز ردیف‌هایی که شماره پرسنلی آن‌ها در برنامه است و آمار و
          خلاصه‌هایی که تعیین شده‌اند پر می‌شوند؛ عنوان‌ها، نام‌ها، قالب‌بندی،
          ادغام‌ها، امضاها و تنظیمات چاپ دست نمی‌خورند. استراحت (OFF) خانه خالی،
          مرخصی H و روز تصمیم‌گیری‌نشده «?» است.
        </p>
        <ExcelTemplateManager
          department={department}
          template={
            template && {
              id: template.id,
              version: template.version,
              revision: template.revision,
              fileName: template.fileName,
              byteSize: template.byteSize,
              uploadedAt: formatJalaliDateTime(
                template.uploadedAt,
                APP_TIMEZONE,
              ),
              uploadedByName: template.uploadedByName,
              mappingUpdatedAt: template.mappingUpdatedAt
                ? formatJalaliDateTime(template.mappingUpdatedAt, APP_TIMEZONE)
                : null,
              mapping: template.mapping,
              inspection: template.inspection,
            }
          }
        />
      </section>
    </>
  );
}
