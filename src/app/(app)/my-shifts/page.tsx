import { MissingShiftReference } from "@/features/shifts/missing-reference";
import type { Metadata } from "next";

import { getNurseDashboard } from "@/application/my-shifts/dashboard";
import { cookies } from "next/headers";
import { CalendarViewSwitch } from "@/features/my-shifts/calendar-view-switch";
import {
  CALENDAR_VIEW_COOKIE,
  parseCalendarView,
  weekPeriod,
  weekStart,
  weeklyHref,
} from "@/features/my-shifts/dashboard-navigation";
import {
  Coworkers,
  DashboardRequests,
  DashboardSummary,
  WeeklyCalendar,
} from "@/features/my-shifts/dashboard-sections";
import { NextShift } from "@/features/my-shifts/next-shift";
import { isIsoDate } from "@/domain/shared/dates";
import { isInPeriod } from "@/domain/shared/period";
import { requireRequestContext } from "@/features/auth/guards";
import { loadOptionalShiftLabels } from "@/features/shifts/labels";
import {
  adjacentJalaliMonth,
  jalaliMonthLabel,
  jalaliMonthParam,
  jalaliMonthPeriod,
  parseJalaliMonthParam,
  toJalali,
  type JalaliMonth,
} from "@/features/calendar/jalali";
import { MyShiftsView } from "@/features/my-shifts/my-shifts-view";
import { myShiftsHref } from "@/features/my-shifts/presentation";
import { ShiftLegend } from "@/features/shell/shift-legend";
import { PageHeader } from "@/features/shell/page-header";
import { APP_TIMEZONE, todayIn } from "@/infrastructure/auth/actor";

export const metadata: Metadata = { title: "شیفت‌های من" };

/**
 * The signed-in nurse dashboard, with a seven-day default and the existing
 * Jalali month calendar. Explicit month links override the remembered view.
 * `?month=1405-08` picks the month (default: the current one in Tehran) and
 * `?day=<ISO date>` the day whose detail is shown (default: today, when it is
 * in the month); invalid values are ignored. There is no user parameter: the
 * query reads only the actor's own shifts and authorizes every schedule.
 */
export default async function MyShiftsPage({
  searchParams,
}: PageProps<"/my-shifts">) {
  const ctx = await requireRequestContext();
  const shiftLabels = await loadOptionalShiftLabels();
  if (!shiftLabels) return <MissingShiftReference />;
  const params = await searchParams;
  // "Today" is Tehran's calendar day, not the server's (UTC) one.
  const now = new Date();
  const today = todayIn(APP_TIMEZONE, now);
  const view =
    parseCalendarView(params.view) ??
    (params.month
      ? "month"
      : parseCalendarView(
          (await cookies()).get(CALENDAR_VIEW_COOKIE)?.value,
        )) ??
    "week";
  const start = weekStart(params.start, today);
  const j = toJalali(today);
  const currentMonth: JalaliMonth = { year: j.year, month: j.month };
  const week = weekPeriod(start);
  const requestedDay = isIsoDate(params.day) ? params.day : null;
  const weekSelected =
    requestedDay && isInPeriod(week, requestedDay) ? requestedDay : start;
  const month =
    view === "week"
      ? toJalali(weekSelected)
      : (parseJalaliMonthParam(params.month) ?? currentMonth);
  const monthParam = jalaliMonthParam(month);
  const period = jalaliMonthPeriod(month);

  const calendarPeriod = view === "week" ? week : period;
  const selected =
    requestedDay && isInPeriod(calendarPeriod, requestedDay)
      ? requestedDay
      : isInPeriod(calendarPeriod, today)
        ? today
        : view === "week"
          ? calendarPeriod.start
          : null;
  const data = await getNurseDashboard(ctx, {
    month: period,
    calendar: calendarPeriod,
    selected,
    today,
  });

  const neighbour = (direction: "previous" | "next") => {
    const target = adjacentJalaliMonth(month, direction);
    return target
      ? {
          href: myShiftsHref(jalaliMonthParam(target)),
          label: jalaliMonthLabel(target),
        }
      : null;
  };
  const isCurrent = monthParam === jalaliMonthParam(currentMonth);

  return (
    <>
      <PageHeader
        title="شیفت‌های من"
        description="شیفت بعدی، برنامه روزهای پیش رو و همکاران هر شیفت، در یک نگاه."
      />
      <div className="flex min-w-0 flex-col gap-5">
        <NextShift
          shifts={data.upcoming}
          initialNow={now.getTime()}
          shiftLabels={shiftLabels}
        />
        <CalendarViewSwitch
          view={view}
          weekHref={weeklyHref(selected ?? period.start)}
          monthHref={myShiftsHref(monthParam, selected ?? undefined)}
        />
        {view === "week" ? (
          <>
            <WeeklyCalendar
              data={data}
              today={today}
              selected={selected ?? calendarPeriod.start}
              shiftLabels={shiftLabels}
            />
            <Coworkers data={data} selected={selected} />
            <DashboardSummary
              data={data}
              label={jalaliMonthLabel(month)}
              shiftLabels={shiftLabels}
            />
            <section
              aria-label="راهنمای شیفت‌ها"
              className="flex flex-col gap-2"
            >
              <h2 className="text-sm font-semibold">راهنمای شیفت‌ها</h2>
              <ShiftLegend withHours shiftLabels={shiftLabels} />
            </section>
          </>
        ) : (
          <MyShiftsView
            shiftLabels={shiftLabels}
            month={data.month}
            label={jalaliMonthLabel(month)}
            previous={neighbour("previous")}
            next={neighbour("next")}
            currentMonthHref={
              isCurrent ? null : myShiftsHref(jalaliMonthParam(currentMonth))
            }
            today={today}
            selected={selected}
            dayHref={(date) => myShiftsHref(monthParam, date)}
            coworkers={<Coworkers data={data} selected={selected} />}
            summary={
              <DashboardSummary
                data={data}
                label={jalaliMonthLabel(month)}
                shiftLabels={shiftLabels}
              />
            }
          />
        )}
        <DashboardRequests requests={data.requests} />
      </div>
    </>
  );
}
