import type { Metadata, Route } from "next";
import { notFound } from "next/navigation";

import { NotFoundError } from "@/application/errors";
import { getDepartmentSchedules } from "@/application/schedules/queries";
import { getScheduleReview } from "@/application/schedules/review";
import { requireRequestContext } from "@/features/auth/guards";
import {
  formatJalaliDate,
  jalaliMonthOptions,
} from "@/features/calendar/jalali";
import { CreateScheduleDialog } from "@/features/schedule/create-schedule-dialog";
import {
  EmptySchedules,
  ScheduleOverviewView,
} from "@/features/schedule/schedule-overview";
import { DayBadges, DayDetail } from "@/features/schedule-review/day-detail";
import { DayDetailDialog } from "@/features/schedule-review/day-detail-dialog";
import { MonthCalendar } from "@/features/schedule-review/month-calendar";
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
  const { schedule, day } = await searchParams;
  // "Today" is Tehran's calendar day, not the server's (UTC) one.
  const today = todayIn(APP_TIMEZONE);
  const orNotFound = (error: unknown): never => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  };

  const data = await getDepartmentSchedules(ctx, {
    departmentId: department.id,
    scheduleId: typeof schedule === "string" ? schedule : undefined,
    today,
  }).catch(orNotFound);

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

  if (!data.selected)
    return (
      <>
        <PageHeader
          title={`برنامه بخش — ${department.name}`}
          description="ایجاد برنامه ماهانه، فهرست پرسنل و مدیریت ثبت ترجیحات پرستاران."
        />
        <EmptySchedules action={createDialog(true)} />
      </>
    );

  const selected = data.selected;
  const review = await getScheduleReview(ctx, {
    departmentId: department.id,
    scheduleId: selected.id,
    day: typeof day === "string" ? day : undefined,
  }).catch(orNotFound);

  const scheduleHref = (id: string, date?: string) =>
    `/departments/${department.code}/schedule?schedule=${id}${date ? `&day=${date}` : ""}` as Route;
  // Schedules are ordered by period; the neighbours are the previous/next months.
  const index = data.schedules.findIndex((s) => s.id === selected.id);
  const neighbour = (i: number) => {
    const s = data.schedules[i];
    return s ? { href: scheduleHref(s.id), label: s.label } : null;
  };

  return (
    <>
      <PageHeader
        title={`برنامه بخش — ${department.name}`}
        description="مرور ماهانه برنامه، فهرست پرسنل و مدیریت ثبت ترجیحات پرستاران."
      />
      <div className="flex flex-col gap-4">
        <div className="flex justify-end">{createDialog(false)}</div>
        <ScheduleOverviewView
          schedule={selected}
          calendar={
            <MonthCalendar
              month={review.month}
              today={today}
              dayHref={(date) => scheduleHref(selected.id, date)}
              previous={neighbour(index - 1)}
              next={neighbour(index + 1)}
            />
          }
        />
      </div>
      {review.day && (
        <DayDetailDialog
          key={review.day.date}
          title={formatJalaliDate(review.day.date, { weekday: true })}
          description={<DayBadges day={review.day} />}
          closeHref={scheduleHref(selected.id)}
          returnFocusId={`day-${review.day.date}`}
        >
          <DayDetail day={review.day} />
        </DayDetailDialog>
      )}
    </>
  );
}
