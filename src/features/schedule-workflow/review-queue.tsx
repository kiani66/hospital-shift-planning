import { ChevronLeft, Inbox, Send } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";

import type { ReviewQueueItem } from "@/application/schedules/supervisor-review";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionHeader } from "@/components/ui/section-header";
import {
  faNumber,
  formatJalaliDateTime,
  formatJalaliRange,
} from "@/features/calendar/jalali";
import { ScheduleStatusBadge } from "@/features/schedule/status-badges";
import { APP_TIMEZONE } from "@/infrastructure/auth/actor";

const when = (instant: Date) => formatJalaliDateTime(instant, APP_TIMEZONE);
const reviewHref = (item: ReviewQueueItem) =>
  `/review/${item.scheduleId}` as Route;

const DECISION_TEXT = {
  APPROVED: "تأیید",
  RETURNED: "برگشت",
  WITHDRAWN: "پس گرفته شد",
} as const;

/** One schedule waiting for the Supervisor: who sent which month when, and the one action. */
function AwaitingRow({ item }: { item: ReviewQueueItem }) {
  const titleId = `awaiting-${item.scheduleId}`;
  return (
    <li
      aria-labelledby={titleId}
      data-schedule={item.scheduleId}
      className="flex flex-col gap-3 rounded-xl border border-status-review/30 bg-card p-3 shadow-xs sm:flex-row sm:items-center sm:justify-between sm:p-4"
    >
      <div className="flex min-w-0 flex-col gap-1">
        <h3 id={titleId} className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-semibold">{item.label}</span>
          <span className="text-sm text-muted-foreground">
            {item.department.name}
          </span>
        </h3>
        <p className="text-sm text-muted-foreground">
          {formatJalaliRange(item.period.start, item.period.end)}
        </p>
        {item.submission && (
          <p className="text-sm">
            ارسال توسط {item.submission.submittedByName} ·{" "}
            <span className="text-muted-foreground">
              {when(item.submission.submittedAt)}
            </span>
          </p>
        )}
        {item.ownSubmission && (
          <p className="text-xs text-muted-foreground">
            خودتان ارسال کرده‌اید؛ تصمیم با سوپروایزر دیگری است.
          </p>
        )}
      </div>
      <Link
        href={reviewHref(item)}
        className={buttonClasses(
          item.ownSubmission ? "outline" : "default",
          "w-full sm:w-auto",
        )}
      >
        {item.ownSubmission ? "مشاهده برنامه" : "بررسی برنامه"}
        <ChevronLeft aria-hidden="true" className="size-4" />
      </Link>
    </li>
  );
}

/** Any other schedule the Supervisor can see: its status and latest decision. */
function OtherRow({ item }: { item: ReviewQueueItem }) {
  const decision = item.submission?.decision;
  return (
    <li data-schedule={item.scheduleId}>
      <Link
        href={reviewHref(item)}
        className="flex min-h-11 flex-col gap-1 px-3 py-2.5 hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-none sm:flex-row sm:items-center sm:justify-between sm:gap-4"
      >
        <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
          <span className="font-medium">{item.label}</span>
          <span className="text-sm text-muted-foreground">
            {item.department.name}
          </span>
        </span>
        <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <ScheduleStatusBadge status={item.status} size="sm" />
          {decision &&
            item.submission?.decidedAt &&
            `${DECISION_TEXT[decision]}: ${when(item.submission.decidedAt)}`}
        </span>
      </Link>
    </li>
  );
}

/**
 * The Supervisor's review list: schedules waiting for a decision first
 * (longest waiting first, each with one action), then the other schedules
 * they may view (finalized, returned, approved) as a compact list.
 */
export function ReviewQueueView({
  awaiting,
  others,
}: {
  awaiting: readonly ReviewQueueItem[];
  others: readonly ReviewQueueItem[];
}) {
  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="awaiting-title" className="flex flex-col gap-3">
        <SectionHeader
          id="awaiting-title"
          title={`در انتظار بررسی (${faNumber(awaiting.length)})`}
          icon={<Send aria-hidden="true" className="rtl:-scale-x-100" />}
        />
        {awaiting.length === 0 ? (
          <EmptyState
            icon={<Inbox aria-hidden="true" />}
            titleId="awaiting-empty"
            headingLevel={3}
            title="برنامه‌ای در انتظار بررسی نیست"
            description="وقتی سرپرستاری برنامه ماهانه‌ای را برای تأیید ارسال کند، اینجا نمایش داده می‌شود و به شما اطلاع داده می‌شود."
          />
        ) : (
          <ul aria-labelledby="awaiting-title" className="flex flex-col gap-2">
            {awaiting.map((item) => (
              <AwaitingRow key={item.scheduleId} item={item} />
            ))}
          </ul>
        )}
      </section>

      {others.length > 0 && (
        <section aria-labelledby="others-title" className="flex flex-col gap-3">
          <SectionHeader
            id="others-title"
            title="سایر برنامه‌های قابل مشاهده"
          />
          <ul
            aria-labelledby="others-title"
            className="divide-y overflow-hidden rounded-xl border bg-card shadow-xs"
          >
            {others.map((item) => (
              <OtherRow key={item.scheduleId} item={item} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
