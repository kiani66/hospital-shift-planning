import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { NotFoundError } from "@/application/errors";
import { getDepartmentSchedules } from "@/application/schedules/queries";
import { requireRequestContext } from "@/features/auth/guards";
import { jalaliMonthOptions } from "@/features/calendar/jalali";
import { CreateScheduleDialog } from "@/features/schedule/create-schedule-dialog";
import {
  EmptySchedules,
  ScheduleOverviewView,
  ScheduleSwitcher,
} from "@/features/schedule/schedule-overview";
import { requireDepartmentPage } from "@/features/shell/department-page";
import { PageHeader } from "@/features/shell/page-header";
import { APP_TIMEZONE, todayIn } from "@/infrastructure/auth/actor";

export const metadata: Metadata = { title: "برنامه بخش" };

/** Head Nurse of this department only (`department.manage`); the use cases check again. */
export default async function DepartmentSchedulePage({
  params,
  searchParams,
}: PageProps<"/departments/[code]/schedule">) {
  const department = await requireDepartmentPage(params, "department.manage");
  const ctx = await requireRequestContext();
  const { schedule } = await searchParams;
  // "Today" is Tehran's calendar day, not the server's (UTC) one.
  const today = todayIn(APP_TIMEZONE);

  const data = await getDepartmentSchedules(ctx, {
    departmentId: department.id,
    scheduleId: typeof schedule === "string" ? schedule : undefined,
    today,
  }).catch((error) => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  });

  const months = jalaliMonthOptions(
    today,
    data.schedules.map((s) => s.period),
  );
  const createDialog = (primary: boolean) => (
    <CreateScheduleDialog
      department={department}
      years={months.years}
      options={months.options}
      suggested={months.suggested}
      primary={primary}
    />
  );

  return (
    <>
      <PageHeader
        title={`برنامه بخش — ${department.name}`}
        description="ایجاد برنامه ماهانه، فهرست پرسنل و مدیریت ثبت ترجیحات پرستاران."
      />
      {data.selected ? (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <ScheduleSwitcher
              departmentCode={department.code}
              schedules={data.schedules}
              selectedId={data.selected.id}
            />
            <div className="sm:ms-auto">{createDialog(false)}</div>
          </div>
          <ScheduleOverviewView schedule={data.selected} />
        </div>
      ) : (
        <EmptySchedules action={createDialog(true)} />
      )}
    </>
  );
}
