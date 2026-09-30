import { ChevronRight } from "lucide-react";
import type { Metadata, Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { NotFoundError } from "@/application/errors";
import { getSupervisorScheduleReview } from "@/application/schedules/supervisor-review";
import { addDays, type IsoDate } from "@/domain/shared/dates";
import { isInPeriod } from "@/domain/shared/period";
import { requireRequestContext } from "@/features/auth/guards";
import {
  faNumber,
  formatJalaliDate,
  formatJalaliRange,
} from "@/features/calendar/jalali";
import { ScheduleHeader } from "@/features/schedule/schedule-header";
import { DayBadges, DayDetail } from "@/features/schedule-review/day-detail";
import { DayDetailDialog } from "@/features/schedule-review/day-detail-dialog";
import { DayNav, type DayLink } from "@/features/schedule-review/day-nav";
import {
  MonthCalendar,
  MonthSummary,
} from "@/features/schedule-review/month-calendar";
import {
  SupervisorDecisionActions,
  SupervisorWorkflowNotice,
} from "@/features/schedule-workflow/workflow-ui";
import { APP_TIMEZONE, todayIn } from "@/infrastructure/auth/actor";

export const metadata: Metadata = { title: "بررسی برنامه" };

const dayLabel = (date: IsoDate) => formatJalaliDate(date, { weekday: true });

/**
 * One schedule for its Supervisor, read-only (Phase 8): the Phase 7a month
 * calendar and day detail (never the editor), the submission, and approve /
 * return while it is SUBMITTED. Only a current Supervisor of the department
 * from FINALIZED on; anything else is the same 404 as an unknown id.
 */
export default async function SupervisorReviewPage({
  params,
  searchParams,
}: PageProps<"/review/[scheduleId]">) {
  const ctx = await requireRequestContext();
  const { scheduleId } = await params;
  const { day } = await searchParams;
  const review = await getSupervisorScheduleReview(ctx, {
    scheduleId,
    day: typeof day === "string" ? day : undefined,
  }).catch((error) => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  });
  const { month, workflow, department } = review;
  const today = todayIn(APP_TIMEZONE);

  const here = (date?: string) =>
    `/review/${month.scheduleId}${date ? `?day=${date}` : ""}` as Route;
  const dayLink = (date: IsoDate): DayLink | null =>
    isInPeriod(month.period, date)
      ? { href: here(date), label: dayLabel(date) }
      : null;
  const dayLinks = review.day && {
    previous: dayLink(addDays(review.day.date, -1)),
    next: dayLink(addDays(review.day.date, 1)),
  };

  return (
    <>
      <Link
        href="/review"
        className="mb-3 inline-flex min-h-11 items-center gap-1 rounded-md text-sm font-medium text-primary hover:underline focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-none"
      >
        <ChevronRight aria-hidden="true" className="size-4" />
        بازگشت به فهرست بررسی
      </Link>
      <ScheduleHeader
        departmentName={department.name}
        monthLabel={month.label}
        schedule={{
          range: `${formatJalaliRange(month.period.start, month.period.end)} · ${faNumber(month.days.length)} روز`,
          status: month.status,
          // The Supervisor's review is read-only, whatever else they may be.
          editable: false,
        }}
        primaryAction={
          <SupervisorDecisionActions
            schedule={{
              scheduleId: month.scheduleId,
              revision: month.revision,
              label: month.label,
            }}
            departmentName={department.name}
            workflow={workflow}
          />
        }
      />
      <div className="flex flex-col gap-3">
        <SupervisorWorkflowNotice workflow={workflow} />
        <MonthSummary month={month} dayHref={here} />
        <MonthCalendar
          month={month}
          today={today}
          dayHref={here}
          selected={review.day?.date ?? null}
        />
      </div>
      {review.day && dayLinks && (
        <DayDetailDialog
          title={dayLabel(review.day.date)}
          description={<DayBadges day={review.day} />}
          closeHref={here()}
          returnFocusId={`day-${review.day.date}`}
          navigation={<DayNav {...dayLinks} />}
        >
          {/* No editor: the Supervisor never changes assignments. */}
          <DayDetail day={review.day} />
        </DayDetailDialog>
      )}
    </>
  );
}
