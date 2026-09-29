import { Bell, BellDot, BellOff, ChevronLeft } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import type {
  NotificationFilter,
  NotificationItem,
} from "@/application/notifications/queries";
import { buttonClasses } from "@/components/ui/button";
import { faNumber, formatJalaliDateTime } from "@/features/calendar/jalali";
import { APP_TIMEZONE } from "@/infrastructure/auth/actor";
import { cn } from "@/lib/utils";

import {
  LIST_HEADING_ID,
  MarkAllReadForm,
  MarkReadForm,
  OpenNotificationForm,
} from "./notification-forms";
import { describeNotification } from "./presentation";

export const FILTER_LABELS: Record<NotificationFilter, string> = {
  all: "همه",
  unread: "خوانده‌نشده",
};

export function notificationsPath(
  filter: NotificationFilter,
  cursor?: string,
): Route {
  const params = new URLSearchParams();
  if (filter === "unread") params.set("filter", "unread");
  if (cursor) params.set("cursor", cursor);
  const query = params.toString();
  return (query ? `/notifications?${query}` : "/notifications") as Route;
}

/** Unread summary, the All/Unread filter and "mark all as read". */
export function NotificationToolbar({
  filter,
  unread,
}: {
  filter: NotificationFilter;
  unread: number;
}) {
  return (
    <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
      <p className="flex items-center gap-2 font-medium" id="unread-summary">
        {unread > 0 ? (
          <BellDot aria-hidden="true" className="size-5 shrink-0" />
        ) : (
          <Bell
            aria-hidden="true"
            className="size-5 shrink-0 text-muted-foreground"
          />
        )}
        {unread > 0
          ? `${faNumber(unread)} اعلان خوانده‌نشده`
          : "همه اعلان‌ها خوانده شده‌اند"}
      </p>
      <nav aria-label="فیلتر اعلان‌ها" className="sm:ms-auto">
        <ul className="grid grid-cols-2 gap-1 rounded-lg border bg-muted/40 p-1 sm:inline-grid">
          {(["all", "unread"] as const).map((value) => {
            const current = value === filter;
            return (
              <li key={value}>
                <Link
                  href={notificationsPath(value)}
                  aria-current={current ? "page" : undefined}
                  className={cn(
                    "flex min-h-11 items-center justify-center gap-2 rounded-md px-4 text-sm font-medium transition-colors",
                    "focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-none",
                    current
                      ? "bg-background shadow-sm ring-1 ring-border"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {FILTER_LABELS[value]}
                  {value === "unread" && unread > 0 && (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums">
                      {faNumber(unread)}
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <MarkAllReadForm unread={unread} />
    </div>
  );
}

function NotificationRow({ item }: { item: NotificationItem }) {
  const view = describeNotification(item);
  const unread = !item.read;
  const Icon = unread ? BellDot : Bell;
  return (
    <li
      className={cn(
        "flex flex-col gap-2 rounded-lg border p-2 sm:flex-row sm:items-center sm:gap-3 sm:p-3",
        unread ? "border-primary/40 bg-accent" : "bg-card",
      )}
    >
      <OpenNotificationForm
        notificationId={item.id}
        className={cn(
          "flex min-h-11 w-full min-w-0 items-start gap-3 rounded-md p-2 text-start transition-colors",
          "hover:bg-background/70 focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-none",
        )}
      >
        <Icon
          aria-hidden="true"
          className={cn(
            "mt-0.5 size-5 shrink-0",
            !unread && "text-muted-foreground",
          )}
        />
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span
              className={cn(
                "leading-relaxed break-words",
                unread ? "font-bold" : "font-medium text-muted-foreground",
              )}
            >
              {view.title}
            </span>
            {unread ? (
              <span className="inline-flex items-center rounded-full border border-primary/40 bg-background px-2 py-0.5 text-xs font-semibold">
                خوانده‌نشده
              </span>
            ) : (
              <span className="sr-only">(خوانده‌شده)</span>
            )}
          </span>
          <span className="text-sm leading-relaxed break-words">
            {view.message}
          </span>
          <span className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {view.context && <span>{view.context}</span>}
            <time dateTime={item.createdAt.toISOString()}>
              {formatJalaliDateTime(item.createdAt, APP_TIMEZONE)}
            </time>
          </span>
          {view.destination && (
            <span className="inline-flex items-center gap-1 text-xs font-semibold underline-offset-4">
              مشاهده
              <ChevronLeft aria-hidden="true" className="size-3.5" />
            </span>
          )}
        </span>
      </OpenNotificationForm>
      {unread && <MarkReadForm notificationId={item.id} title={view.title} />}
    </li>
  );
}

function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed bg-muted/30 px-4 py-10 text-center">
      <BellOff aria-hidden="true" className="size-8 text-muted-foreground" />
      <h3 className="font-semibold">{title}</h3>
      <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
        {description}
      </p>
      {action}
    </div>
  );
}

/** The page of notifications, its empty states and the older/newest links. */
export function NotificationList({
  filter,
  items,
  cursor,
  nextCursor,
}: {
  filter: NotificationFilter;
  items: readonly NotificationItem[];
  /** The page shown is not the newest one. */
  cursor: string | null;
  nextCursor: string | null;
}) {
  const newest = (
    <Link href={notificationsPath(filter)} className={buttonClasses("outline")}>
      جدیدترین اعلان‌ها
    </Link>
  );

  let empty: ReactNode = null;
  if (items.length === 0) {
    empty = cursor ? (
      <EmptyState
        title="اعلان دیگری نیست"
        description="اعلان قدیمی‌تری در این فهرست وجود ندارد."
        action={newest}
      />
    ) : filter === "unread" ? (
      <EmptyState
        title="اعلان خوانده‌نشده‌ای ندارید"
        description="همه اعلان‌های شما خوانده شده‌اند."
        action={
          <Link
            href={notificationsPath("all")}
            className={buttonClasses("outline")}
          >
            نمایش همه اعلان‌ها
          </Link>
        }
      />
    ) : (
      <EmptyState
        title="هنوز اعلانی ندارید"
        description="وقتی کاری مربوط به شما در برنامه شیفت انجام شود، مثلاً باز شدن ثبت ترجیحات، اینجا باخبر می‌شوید."
      />
    );
  }

  return (
    <section aria-labelledby={LIST_HEADING_ID} className="flex flex-col gap-4">
      <h2
        id={LIST_HEADING_ID}
        tabIndex={-1}
        className="sr-only focus:not-sr-only focus:outline-none"
      >
        {filter === "unread" ? "اعلان‌های خوانده‌نشده" : "همه اعلان‌ها"}
      </h2>
      {empty ?? (
        <ul className="flex flex-col gap-2">
          {items.map((item) => (
            <NotificationRow key={item.id} item={item} />
          ))}
        </ul>
      )}
      {items.length > 0 && (cursor || nextCursor) && (
        <nav
          aria-label="صفحه‌بندی اعلان‌ها"
          className="flex flex-col gap-2 sm:flex-row sm:justify-between"
        >
          {cursor ? newest : <span className="max-sm:hidden" />}
          {nextCursor && (
            <Link
              href={notificationsPath(filter, nextCursor)}
              className={buttonClasses("outline")}
            >
              اعلان‌های قدیمی‌تر
            </Link>
          )}
        </nav>
      )}
    </section>
  );
}
