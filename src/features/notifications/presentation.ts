import type { Route } from "next";

import type {
  NotificationItem,
  NotificationType,
} from "@/application/notifications/queries";
import { compareIsoDates, isIsoDate } from "@/domain/shared/dates";
import { formatJalaliRange } from "@/features/calendar/jalali";

/**
 * Turns a stored notification (type + structured data) into Persian text and
 * a destination. Text is rendered at display time, so wording can change
 * without touching stored rows. `data` is untrusted JSON: every field is
 * checked before use and missing fields fall back to generic wording.
 */

export interface NotificationView {
  readonly title: string;
  readonly message: string;
  /** "بخش ICU · آبان ۱۴۰۵", when the notification refers to a schedule. */
  readonly context: string | null;
  /** Where opening it leads; null means opening only marks it read. */
  readonly destination: Route | null;
}

const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" ? value.trim() : null;

const isoDate = (value: unknown) =>
  typeof value === "string" && isIsoDate(value) ? value : null;

/** "۱ تا ۳۰ آبان ۱۴۰۵" from `firstDate`/`lastDate`, when both are valid. */
function dateRange(data: NotificationItem["data"]): string | null {
  const from = isoDate(data.firstDate);
  const to = isoDate(data.lastDate);
  return from && to && compareIsoDates(from, to) <= 0
    ? formatJalaliRange(from, to)
    : null;
}

/** The schedule's current label, else the one stored with the notification. */
function scheduleLabel(item: NotificationItem): string | null {
  return item.context?.scheduleLabel ?? text(item.data.label);
}

/**
 * The preference page (Phase 6) with the notification's schedule selected
 * (the project's `?schedule=` convention). The page authorizes the schedule
 * itself; the link grants nothing.
 */
function preferencesPath(scheduleId: string | null): Route {
  return (
    scheduleId
      ? `/preferences?schedule=${encodeURIComponent(scheduleId)}`
      : "/preferences"
  ) as Route;
}

/**
 * Where opening a notification leads, from its stored type and schedule
 * (never from anything the browser sends, so it cannot become an open
 * redirect). Only types that are created today and have a page are routed;
 * the rest return null and opening them only marks them read.
 */
export function notificationDestination(notification: {
  readonly type: NotificationType;
  readonly scheduleId: string | null;
}): Route | null {
  switch (notification.type) {
    case "PREFERENCES_OPENED":
    case "DATES_REOPENED":
      return preferencesPath(notification.scheduleId);
    default:
      return null;
  }
}

type Renderer = (item: NotificationItem) => {
  title: string;
  message: string;
};

const forSchedule = (item: NotificationItem, fallback: string) => {
  const label = scheduleLabel(item);
  return label ? `«${label}»` : fallback;
};

/**
 * Every stored type has wording. Only PREFERENCES_OPENED is created today
 * (Phase 4); the other enum values get neutral text and no destination until
 * the phase that creates them defines where they lead.
 */
const RENDERERS: Record<NotificationType, Renderer> = {
  PREFERENCES_OPENED: (item) => {
    const range = dateRange(item.data);
    const schedule = forSchedule(item, "برنامه ماه آینده");
    return {
      title: "ثبت ترجیحات باز شد",
      message: range
        ? `می‌توانید ترجیحات شیفت خود را برای ${schedule} (${range}) ثبت کنید.`
        : `می‌توانید ترجیحات شیفت خود را برای ${schedule} ثبت کنید.`,
    };
  },
  DATES_REOPENED: (item) => {
    const range = dateRange(item.data);
    return {
      title: "ثبت ترجیحات دوباره باز شد",
      message: range
        ? `ثبت ترجیحات برای ${range} در ${forSchedule(item, "برنامه")} دوباره باز شد.`
        : `ثبت ترجیحات برای بخشی از ${forSchedule(item, "برنامه")} دوباره باز شد.`,
    };
  },
  SCHEDULE_FINALIZED: (item) => ({
    title: "برنامه نهایی شد",
    message: `برنامه ${forSchedule(item, "شیفت")} نهایی شد.`,
  }),
  SCHEDULE_SUBMITTED: (item) => ({
    title: "برنامه برای تأیید ارسال شد",
    message: `برنامه ${forSchedule(item, "شیفت")} برای تأیید ارسال شد.`,
  }),
  SCHEDULE_APPROVED: (item) => ({
    title: "برنامه تأیید شد",
    message: `برنامه ${forSchedule(item, "شیفت")} تأیید شد.`,
  }),
  SCHEDULE_RETURNED: (item) => ({
    title: "برنامه برای اصلاح برگشت داده شد",
    message: `برنامه ${forSchedule(item, "شیفت")} برای اصلاح برگشت داده شد.`,
  }),
  REVISION_STARTED: (item) => ({
    title: "بازنگری برنامه آغاز شد",
    message: `بازنگری برنامه ${forSchedule(item, "شیفت")} آغاز شد.`,
  }),
  CHANGE_REQUEST_SUBMITTED: (item) => ({
    title: "درخواست تغییر شیفت ثبت شد",
    message: `یک درخواست تغییر شیفت برای ${forSchedule(item, "برنامه")} ثبت شد.`,
  }),
  CHANGE_REQUEST_REVIEWED: (item) => ({
    title: "درخواست تغییر شیفت بررسی شد",
    message: `درخواست تغییر شیفت شما برای ${forSchedule(item, "برنامه")} بررسی شد.`,
  }),
};

export function describeNotification(item: NotificationItem): NotificationView {
  const render = RENDERERS[item.type] as Renderer | undefined;
  const view = render
    ? render(item)
    : { title: "اعلان", message: "اعلان جدیدی برای شما ثبت شده است." };
  const context = item.context
    ? `${item.context.departmentName} · ${item.context.scheduleLabel}`
    : scheduleLabel(item);
  return { ...view, context, destination: notificationDestination(item) };
}
