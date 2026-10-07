import { Info } from "lucide-react";
import type { Metadata, Route } from "next";
import { notFound } from "next/navigation";

import { NotFoundError } from "@/application/errors";
import { getDepartmentSchedules } from "@/application/schedules/queries";
import { getRosterCandidates } from "@/application/schedules/roster";
import { Callout } from "@/components/ui/callout";
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
import { RosterAdditions } from "@/features/schedule/roster-additions";
import { ScheduleHeader } from "@/features/schedule/schedule-header";
import {
  EmptySchedules,
  PreferenceAction,
  ScheduleDetails,
} from "@/features/schedule/schedule-overview";
import { getAdjustmentReasons } from "@/application/change-requests/queries";
import { AdjustmentForm } from "@/features/change-request-review/adjustment-form";
import { DirectSwapForm } from "@/features/schedule-editing/direct-swap-form";
import { DayEditor } from "@/features/schedule-editing/day-editor";
import {
  HeadNurseLifecycleAction,
  HeadNurseWorkflowNotice,
} from "@/features/schedule-workflow/workflow-ui";
import {
  DayBadges,
  DayDetail,
  flaggedNurses,
} from "@/features/schedule-review/day-detail";
import { ShortageCandidates } from "@/features/coverage-candidates/shortage-candidates";
import { DayDetailDialog } from "@/features/schedule-review/day-detail-dialog";
import { DayNav, type DayLink } from "@/features/schedule-review/day-nav";
import { EmptyMonth } from "@/features/schedule-review/empty-month";
import {
  isDayFilter,
  type DayFilter,
} from "@/features/schedule-review/presentation";
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
      coverage={day.coverage.map((c) => ({
        period: c.period,
        bounds: c.bounds,
      }))}
      previousDayHref={links.previous?.href ?? null}
      nextDayHref={links.next?.href ?? null}
    />
  );
}

/**
 * Phase 9 operational adjustment, offered only where the planning editor
 * cannot act under the approved rules: an APPROVED schedule (the change
 * opens a revision) or a day outside an open revision's scope (the change
 * extends it); never a past day. In FINALIZED / in-scope days the editor
 * stays the way to change shifts. The use case decides again.
 */
function canOfferAdjustment(
  day: DayReview,
  status: string,
  today: IsoDate,
): boolean {
  if (day.edit.allowed || day.date < today) return false;
  return (
    (day.edit.reason === "SCHEDULE_LOCKED" && status === "APPROVED") ||
    day.edit.reason === "DATE_OUTSIDE_REVISION_SCOPE"
  );
}

/** Head Nurse of this department only (`department.manage`); the use cases check again. */
export default async function DepartmentSchedulePage({
  params,
  searchParams,
}: PageProps<"/departments/[code]/schedule">) {
  const department = await requireDepartmentPage(params, "department.manage");
  const ctx = await requireRequestContext();
  const { schedule, day, month, filter } = await searchParams;
  // `?filter=undecided|coverage|…` marks the days of one category (D104).
  const activeFilter = isDayFilter(filter) ? filter : null;
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

  // Day links and closing keep the URL form (and the filter) the page was opened with.
  const withFilter = (href: Route, f: DayFilter | null) =>
    (f ? `${href}&filter=${f}` : href) as Route;
  const base = (date?: string) =>
    requestedMonth ? monthHref(current, date) : scheduleHref(selected.id, date);
  const here = (date?: string) => withFilter(base(date), activeFilter);
  const filterHref = (f: DayFilter | null) => withFilter(base(), f);
  // Previous / next day of the open day, within the period (chronological).
  const dayLink = (date: IsoDate): DayLink | null =>
    isInPeriod(review.month.period, date)
      ? { href: here(date), label: dayLabel(date) }
      : null;
  const dayLinks = review.day && {
    previous: dayLink(addDays(review.day.date, -1)),
    next: dayLink(addDays(review.day.date, 1)),
  };

  const adjustment =
    review.day && canOfferAdjustment(review.day, selected.status, today) ? (
      <AdjustmentForm
        key={review.day.date}
        scheduleId={selected.id}
        revision={review.month.revision}
        date={review.day.date}
        nurses={review.day.roster.map((n) => ({
          userId: n.userId,
          displayName: n.displayName,
          shift: n.shift,
        }))}
        reasons={await getAdjustmentReasons(ctx)}
      />
    ) : undefined;

  const noAssignments =
    review.month.totals.NOT_STARTED === review.month.days.length;

  // Explicit roster additions while the schedule is DRAFT / PLANNING.
  const rosterCandidates = await getRosterCandidates(ctx, {
    scheduleId: selected.id,
  }).catch(orNotFound);

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
        primaryAction={
          <>
            <PreferenceAction schedule={selected} />
            <HeadNurseLifecycleAction
              schedule={{
                scheduleId: selected.id,
                revision: review.month.revision,
                label: selected.label,
              }}
              workflow={review.workflow}
            />
          </>
        }
        secondaryAction={data.canCreate ? createDialog(false) : null}
      />
      <div className="flex flex-col gap-3">
        <HeadNurseWorkflowNotice workflow={review.workflow} dayHref={here} />
        <MonthSummary
          month={review.month}
          filter={activeFilter}
          filterHref={filterHref}
          ruleSetHref={
            `/departments/${department.code}/coverage-rules` as Route
          }
        />
        {noAssignments && (
          <Callout role="note" tone="info" icon={Info}>
            هنوز تصمیمی در این برنامه ثبت نشده است؛ همه روزها شروع‌نشده‌اند.
            {review.month.editable &&
              " برای چیدن شیفت‌ها، روزی را در تقویم انتخاب کنید."}
          </Callout>
        )}
        <MonthCalendar
          month={review.month}
          today={today}
          dayHref={here}
          selected={review.day?.date ?? null}
          filter={activeFilter}
        />
      </div>
      <div className="mt-6">
        <ScheduleDetails
          schedule={selected}
          rosterAction={
            rosterCandidates.editable ? (
              <RosterAdditions
                scheduleId={selected.id}
                revision={review.month.revision}
                candidates={rosterCandidates.candidates}
              />
            ) : undefined
          }
        />
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
            candidates={
              <ShortageCandidates
                key={`${selected.id}-${review.day.date}`}
                scheduleId={selected.id}
                date={review.day.date}
                coverage={review.day.coverage}
                period={review.month.period}
                revision={review.month.revision}
              />
            }
            day={review.day}
            adjustment={adjustment}
            directSwap={
              (review.day.edit.allowed ||
                (selected.status === "APPROVED" &&
                  review.day.date >= today)) && (
                <DirectSwapForm
                  key={`direct-swap:${review.day.date}`}
                  scheduleId={selected.id}
                  revision={review.month.revision}
                  date={review.day.date}
                  nurses={review.day.roster}
                  reasons={await getAdjustmentReasons(ctx)}
                />
              )
            }

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
