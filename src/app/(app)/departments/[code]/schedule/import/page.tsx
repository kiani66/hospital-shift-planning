import { APP_TIMEZONE, todayIn } from "@/infrastructure/auth/actor";
import { loadShiftLabels } from "@/features/shifts/labels";
import { toJalali } from "@/features/calendar/jalali";
import { MonthlyScheduleImport } from "@/features/schedule-import/import-wizard";
import { requireDepartmentPage } from "@/features/shell/department-page";
import { PageHeader } from "@/features/shell/page-header";

export default async function ScheduleImportPage({
  params,
}: PageProps<"/departments/[code]/schedule/import">) {
  const department = await requireDepartmentPage(params, "department.manage");
  const shiftLabels = await loadShiftLabels();
  const today = toJalali(todayIn(APP_TIMEZONE));
  return (
    <>
      <PageHeader title="ورود برنامه ماهانه از Excel" />
      <MonthlyScheduleImport
        department={department}
        shiftLabels={shiftLabels}
        suggested={{ year: today.year, month: today.month }}
      />
    </>
  );
}
