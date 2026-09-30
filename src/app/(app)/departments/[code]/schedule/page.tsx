import type { Metadata, Route } from "next";
import { notFound } from "next/navigation";

import { NotFoundError } from "@/application/errors";
import { getDepartmentSchedules } from "@/application/schedules/queries";
import { getScheduleReview } from "@/application/schedules/review";
import { requireRequestContext } from "@/features/auth/guards";
import {
  adjacentJalaliMonth,
  formatJalaliDate,
  jalaliMonthLabel,
  jalaliMonthOptions,
  jalaliMonthParam,
  jalaliMonthPeriod,
  parseJalaliMonthParam,
  toJalali,
  type JalaliMonth,
} from "@/features/calendar/jalali";
import { CreateScheduleDialog } from "@/features/schedule/create-schedule-dialog";
import {
  EmptySchedules,
  ScheduleOverviewView,
} from "@/features/schedule/schedule-overview";
import { DayBadges, DayDetail } from "@/features/schedule-review/day-detail";
import { DayDetailDialog } from "@/features/schedule-review/day-detail-dialog";
import { EmptyMonth } from "@/features/schedule-review/empty-month";
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
  const { schedule, day, month } = await searchParams;
  // "Today" is Tehran's calendar day, not the server's (UTC) one.
  const today = todayIn(APP_TIMEZONE);
  const orNotFound = (error: unknown): never => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  };

  // `?month=1405-08` shows that calendar month, schedule or not. Without it,
  // `?schedule=<id>` (e.g. after creating one) or the default schedule.
  const requestedMonth = parseJalaliMonthParam(month);
  const data = await getDepartmentSchedules(ctx, {
    departmentId: department.id,
    today,
    ...(requestedMonth
      ? { period: jalaliMonthPeriod(requestedMonth) }
      : { scheduleId: typeof schedule === "string" ? schedule : undefined }),
  }).catch(orNotFound);

  const periods = data.schedules.map((s) => s.period);
  const createDialog = (primary: boolean, focus?: JalaliMonth) => {
    const months = jalaliMonthOptions(today, periods, focus);
    return (
      <CreateScheduleDialog
        // The dialog keeps its picked month in state; remount for another month.
        key={focus ? jalaliMonthParam(focus) : "default"}
        department={department}
        years={months.years}
        options={months.options}
        suggested={months.suggested}
        primary={primary}
      />
    );
  };

  const monthHref = (target: JalaliMonth, date?: string) =>
    `/departments/${department.code}/schedule?month=${jalaliMonthParam(target)}${date ? `&day=${date}` : ""}` as Route;
  const scheduleHref = (id: string, date?: string) =>
    `/departments/${department.code}/schedule?schedule=${id}${date ? `&day=${date}` : ""}` as Route;
  const header = (
    <PageHeader
      title={`برنامه بخش — ${department.name}`}
      description={
        data.selected || requestedMonth
          ? "مرور ماهانه برنامه، فهرست پرسنل و مدیریت ثبت ترجیحات پرستاران."
          : "ایجاد برنامه ماهانه، فهرست پرسنل و مدیریت ثبت ترجیحات پرستاران."
      }
    />
  );

  if (!data.selected && !requestedMonth)
    return (
      <>
        {header}
        <EmptySchedules action={createDialog(true)} />
      </>
    );

  // The month on screen: the requested one, else the one the schedule starts in.
  const current: JalaliMonth = requestedMonth ?? {
    year: toJalali(data.selected!.period.start).year,
    month: toJalali(data.selected!.period.start).month,
  };
  // Calendar months, never "the nearest month with a schedule".
  const neighbour = (direction: "previous" | "next") => {
    const target = adjacentJalaliMonth(current, direction);
    return target
      ? { href: monthHref(target), label: jalaliMonthLabel(target) }
      : null;
  };
  const previous = neighbour("previous");
  const next = neighbour("next");

  if (!data.selected)
    return (
      <>
        {header}
        <EmptyMonth
          label={jalaliMonthLabel(current)}
          previous={previous}
          next={next}
          action={data.canCreate ? createDialog(true, current) : null}
        />
      </>
    );

  const selected = data.selected;
  const review = await getScheduleReview(ctx, {
    departmentId: department.id,
    scheduleId: selected.id,
    day: typeof day === "string" ? day : undefined,
  }).catch(orNotFound);

  // Day links and closing keep the URL form the page was opened with.
  const here = (date?: string) =>
    requestedMonth ? monthHref(current, date) : scheduleHref(selected.id, date);

  return (
    <>
      {header}
      <div className="flex flex-col gap-4">
        <div className="flex justify-end">{createDialog(false)}</div>
        <ScheduleOverviewView
          schedule={selected}
          calendar={
            <MonthCalendar
              month={review.month}
              today={today}
              dayHref={here}
              previous={previous}
              next={next}
            />
          }
        />
      </div>
      {review.day && (
        <DayDetailDialog
          key={review.day.date}
          title={formatJalaliDate(review.day.date, { weekday: true })}
          description={<DayBadges day={review.day} />}
          closeHref={here()}
          returnFocusId={`day-${review.day.date}`}
        >
          <DayDetail day={review.day} />
        </DayDetailDialog>
      )}
    </>
  );
}
