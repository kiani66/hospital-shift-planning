import { CircleCheck, CircleDashed } from "lucide-react";
import type { Metadata, Route } from "next";
import Link from "next/link";

import { listExcelTemplateOverview } from "@/application/excel-export/templates";
import { Badge } from "@/components/ui/badge";
import { requireRequestContext } from "@/features/auth/guards";
import { formatJalaliDateTime } from "@/features/calendar/jalali";
import { managementPageRead } from "@/features/management/page-read";
import { PageHeader } from "@/features/shell/page-header";
import { APP_TIMEZONE } from "@/infrastructure/auth/actor";

export const metadata: Metadata = { title: "قالب‌های خروجی اکسل" };

/** Hospital Admin only: every department's Excel export template (D124). */
export default async function ExcelTemplatesAdminPage() {
  const ctx = await requireRequestContext();
  const departments = await managementPageRead(listExcelTemplateOverview(ctx));
  return (
    <>
      <PageHeader
        title="قالب‌های خروجی اکسل"
        description="قالب Excel هر بخش برای خروجی برنامه ماهانه. بارگذاری، جایگزینی و نگاشت در تنظیمات همان بخش انجام می‌شود."
      />
      <ul className="flex flex-col gap-2">
        {departments.map(({ department, template }) => (
          <li
            key={department.id}
            className="flex flex-wrap items-center gap-3 rounded-xl border p-3"
          >
            <span className="font-medium">{department.name}</span>
            {template ? (
              <Badge tone="valid" icon={CircleCheck}>
                <bdi>{template.fileName}</bdi> ·{" "}
                {formatJalaliDateTime(template.uploadedAt, APP_TIMEZONE)}
              </Badge>
            ) : (
              <Badge tone="muted" icon={CircleDashed}>
                بدون قالب
              </Badge>
            )}
            <Link
              className="ms-auto text-sm underline"
              href={
                `/departments/${encodeURIComponent(department.code)}/settings` as Route
              }
            >
              تنظیمات بخش
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
