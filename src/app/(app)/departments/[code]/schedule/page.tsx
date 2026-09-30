import type { Metadata, Route } from "next";
import { notFound } from "next/navigation";

import { NotFoundError } from "@/application/errors";
import { getDepartmentSchedules } from "@/application/schedules/queries";
import {
  getScheduleReview,
  type DayReview,
} from "@/application/schedules/review";
import { addDays, eachDay, type IsoDate } from "@/domain/shared/dates";
import { isInPeriod, type DatePeriod } from "@/domain/shared/period";
import { requireRequestContext } from "@/features/auth/guards";
import {
  adjacentJalaliMonth,
  faNumber,
  formatJalaliDate,
  formatJalaliRange,
  jalaliMonthLabel,
  jalaliMonthOptions,
  jalaliMonthParam,
  jalaliMonthPeriod,
  parseJalaliMonthParam,
  toJalali,
  type JalaliMonth,
} from "@/features/calendar/jalali";
import { CreateScheduleDialog } from "@/features/schedule/create-schedule-dialog";
import { ScheduleHeader } from "@/features/schedule/schedule-header";
import {
  EmptySchedules,
  PreferenceAction,
  ScheduleDetails,
} from "@/features/schedule/schedule-overview";
import { DayEditor } from "@/features/schedule-editing/day-editor";
import {
  DayBadges,
  DayDetail,
  flaggedNurses,
} from "@/features/schedule-review/day-detail";
import { DayDetailDialog } from "@/features/schedule-review/day-detail-dialog";
import { DayNav, type DayLink } from "@/features/schedule-review/day-nav";
import { EmptyMonth } from "@/features/schedule-review/empty-month";
import {
  MonthCalendar,
  MonthSummary,
} from "@/features/schedule-review/month-calendar";
import { requireDepartmentPage } from "@/features/shell/department-page";
import { PageHeader } from "@/features/shell/page-header";
import { APP_TIMEZONE, todayIn } from "@/infrastructure/auth/actor";

export const metadata: Metadata = { title: "برنامه بخش" };

const dayLabel = (date: IsoDate) => formatJalaliDate(date, { weekday: true });

/** The Head Nurse's editor for a day the use cases let them edit. */
function dayEditor(
  day: DayReview,
  schedule: { id: string; revision: number; period: DatePeriod },
  links: { previous: DayLink | null; next: DayLink | null },
) {
  if (!day.edit.allowed) return undefined;
  const flagged = flaggedNurses(day);
  const rangeEnds =
    day.date < schedule.period.end
      ? eachDay(addDays(day.date, 1), schedule.period.end).map((date) => ({
          date,
          label: dayLabel(date),
        }))
      : [];
  return (
    <DayEditor
      scheduleId={schedule.id}
      revision={schedule.revision}
      date={day.date}
      dayLabel={dayLabel(day.date)}
      nurses={day.roster.map((n) => ({
        ...n,
        flagged: flagged.has(n.userId),
      }))}
      rangeEnds={rangeEnds}
      previousDayHref={links.previous?.href ?? null}
      nextDayHref={links.next?.href ?? null}
    />
  );
}

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

  // A department with no schedule at all: the one first step (D39).
  if (!data.selected && !requestedMonth)
    return (
      <>
        <PageHeader title={`برنامه بخش — ${department.name}`} />
        <EmptySchedules action={data.canCreate ? createDialog(true) : null} />
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

  const monthLabel = jalaliMonthLabel(current);

  // A month without a schedule stays the selected month (D39).
  if (!data.selected)
    return (
      <>
        <ScheduleHeader
          departmentName={department.name}
          monthLabel={monthLabel}
          previous={previous}
          next={next}
          schedule={null}
        />
        <EmptyMonth
          label={monthLabel}
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
  // Previous / next day of the open day, within the period (chronological).
  const dayLink = (date: IsoDate): DayLink | null =>
    isInPeriod(review.month.period, date)
      ? { href: here(date), label: dayLabel(date) }
      : null;
  const dayLinks = review.day && {
    previous: dayLink(addDays(review.day.date, -1)),
    next: dayLink(addDays(review.day.date, 1)),
  };

  const noAssignments =
    review.month.totals.UNPLANNED === review.month.days.length;

  return (
    <>
      <ScheduleHeader
        departmentName={department.name}
        monthLabel={monthLabel}
        previous={previous}
        next={next}
        schedule={{
          range: `${formatJalaliRange(selected.period.start, selected.period.end)} · ${faNumber(selected.dayCount)} روز`,
          status: selected.status,
          preferences: selected.preferences.state,
          editable: review.month.editable,
        }}
        primaryAction={<PreferenceAction schedule={selected} />}
        secondaryAction={data.canCreate ? createDialog(false) : null}
      />
      <div className="flex flex-col gap-3">
        <MonthSummary month={review.month} dayHref={here} />
        {noAssignments && (
          <p
            role="note"
            className="rounded-md border border-dashed px-3 py-2.5 text-sm leading-relaxed text-muted-foreground"
          >
            هنوز شیفتی در این برنامه ثبت نشده است؛ همه روزها
            برنامه‌ریزی‌نشده‌اند.
            {review.month.editable &&
              " برای چیدن شیفت‌ها، روزی را در تقویم انتخاب کنید."}
          </p>
        )}
        <MonthCalendar
          month={review.month}
          today={today}
          dayHref={here}
          selected={review.day?.date ?? null}
        />
      </div>
      <div className="mt-6">
        <ScheduleDetails schedule={selected} />
      </div>
      {review.day && dayLinks && (
        // Not keyed by date: it stays open (and keeps focus) across days.
        <DayDetailDialog
          title={dayLabel(review.day.date)}
          description={<DayBadges day={review.day} />}
          closeHref={here()}
          returnFocusId={`day-${review.day.date}`}
          navigation={<DayNav {...dayLinks} />}
        >
          <DayDetail
            day={review.day}
            editor={dayEditor(
              review.day,
              {
                id: selected.id,
                revision: review.month.revision,
                period: review.month.period,
              },
              dayLinks,
            )}
          />
        </DayDetailDialog>
      )}
    </>
  );
}
