import { Inbox, TriangleAlert } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";

import type {
  ChangeRequestQueue,
  ChangeRequestQueueItem,
} from "@/application/change-requests/queries";
import { Badge } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import type { ChangeRequestStatus } from "@/domain/change-requests/model";
import type { AssignmentCode } from "@/domain/shifts/shift-type";
import {
  faNumber,
  formatJalaliDate,
  formatJalaliDateTime,
} from "@/features/calendar/jalali";
import {
  APPLIED_STATE,
  CONSENT_STATUS,
  REQUEST_STATUS,
  REQUEST_TYPE_LABELS,
} from "@/features/change-requests/presentation";
import { ShiftChip } from "@/features/shifts/shift-chip";
import { APP_TIMEZONE } from "@/infrastructure/auth/actor";
import { cn } from "@/lib/utils";

/** Tab order: what needs a decision first. */
export const QUEUE_TABS: readonly ChangeRequestStatus[] = [
  "PENDING",
  "APPLIED",
  "REJECTED",
  "CANCELLED",
];

const TAB_LABELS: Record<ChangeRequestStatus, string> = {
  PENDING: "در انتظار",
  APPLIED: "اعمال‌شده",
  REJECTED: "ردشده",
  CANCELLED: "لغوشده",
};

const Shift = ({ code }: { code: AssignmentCode | null }) =>
  code ? (
    <ShiftChip code={code} size="xs" label />
  ) : (
    <span className="text-xs text-muted-foreground">تعیین‌نشده</span>
  );

/** What the request asks for, compactly. */
function RequestedChange({ item }: { item: ChangeRequestQueueItem }) {
  switch (item.type) {
    case "CHANGE_SHIFT":
      return <Shift code={item.targetShift} />;
    case "UNAVAILABLE":
      return <Shift code="OFF" />;
    case "SWAP":
      return (
        <span className="flex items-center gap-1.5 text-xs">
          با {item.counterpart?.displayName} (
          <Shift code={item.counterpartShift} />)
        </span>
      );
    case "OTHER":
      return <span className="text-xs">به تشخیص سرپرستار</span>;
  }
}

export function QueueTabs({
  queue,
  href,
}: {
  queue: ChangeRequestQueue;
  href: (status: ChangeRequestStatus) => Route;
}) {
  return (
    <nav aria-label="وضعیت درخواست‌ها" className="overflow-x-auto">
      <ul className="flex gap-1.5">
        {QUEUE_TABS.map((status) => {
          const current = status === queue.status;
          return (
            <li key={status}>
              <Link
                href={href(status)}
                aria-current={current ? "page" : undefined}
                className={cn(
                  buttonClasses(current ? "default" : "outline"),
                  "min-h-10 px-3",
                )}
              >
                {TAB_LABELS[status]}
                <span className="tabular-nums">
                  ({faNumber(queue.counts[status])})
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * The department's requests of one status. Each row shows who, when, the
 * shift the request was made against (and, for pending ones, the live shift
 * when it has changed since), what is asked, the reason, the swap partner
 * and their consent, and the status; the row opens the request's detail.
 */
export function QueueList({
  queue,
  detailHref,
}: {
  queue: ChangeRequestQueue;
  detailHref: (id: string) => Route;
}) {
  if (queue.items.length === 0)
    return (
      <EmptyState
        icon={<Inbox className="size-6" />}
        title={
          queue.status === "PENDING"
            ? "درخواست در انتظاری نیست"
            : `درخواست ${TAB_LABELS[queue.status]}ی نیست`
        }
        headingLevel={2}
        description="درخواست‌های تغییر شیفت پرستاران این بخش اینجا نمایش داده می‌شود."
      />
    );
  return (
    <ul
      aria-label={`درخواست‌های ${TAB_LABELS[queue.status]}`}
      className="flex flex-col gap-2"
    >
      {queue.items.map((item) => {
        const date = formatJalaliDate(item.date, { weekday: true });
        const changed =
          item.current !== null &&
          item.current.requester !== item.requesterShift;
        const title = `${item.requester.displayName} · ${REQUEST_TYPE_LABELS[item.type]} · ${date}`;
        return (
          <li key={item.id}>
            <article
              aria-label={title}
              className="flex flex-col gap-2 rounded-xl border bg-card p-3 shadow-xs sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex min-w-0 flex-col gap-1.5">
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="font-semibold">
                    {item.requester.displayName}
                  </span>
                  <span className="text-sm text-muted-foreground">{date}</span>
                  <Badge tone="brand-soft" size="sm">
                    {REQUEST_TYPE_LABELS[item.type]}
                  </Badge>
                  <Badge tone={REQUEST_STATUS[item.status].tone} size="sm">
                    {REQUEST_STATUS[item.status].label}
                  </Badge>
                  {item.consent && item.status === "PENDING" && (
                    <Badge tone={CONSENT_STATUS[item.consent].tone} size="sm">
                      {CONSENT_STATUS[item.consent].label}
                    </Badge>
                  )}
                  {item.applied && (
                    <Badge
                      tone={APPLIED_STATE[item.applied.state].tone}
                      size="sm"
                    >
                      {APPLIED_STATE[item.applied.state].label}
                    </Badge>
                  )}
                </p>
                <p className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="text-muted-foreground">شیفت:</span>
                  <Shift code={item.requesterShift} />
                  <span aria-hidden="true">←</span>
                  <span className="sr-only">درخواست:</span>
                  <RequestedChange item={item} />
                  {changed && (
                    <span className="flex items-center gap-1 text-xs text-health-attention-foreground">
                      <TriangleAlert aria-hidden="true" className="size-3.5" />
                      شیفت فعلی:
                      <Shift code={item.current!.requester} />
                    </span>
                  )}
                </p>
                <p className="text-xs text-muted-foreground">
                  علت: {item.reason.label} · ثبت:{" "}
                  {formatJalaliDateTime(item.createdAt, APP_TIMEZONE)}
                </p>
              </div>
              <Link
                href={detailHref(item.id)}
                scroll={false}
                className={cn(buttonClasses("outline"), "shrink-0")}
                aria-label={`بررسی درخواست ${title}`}
              >
                {item.status === "PENDING" ? "بررسی و تصمیم" : "جزئیات"}
              </Link>
            </article>
          </li>
        );
      })}
    </ul>
  );
}
