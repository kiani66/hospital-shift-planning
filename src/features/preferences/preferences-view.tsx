import {
  CalendarClock,
  CalendarDays,
  CircleAlert,
  Info,
  Lock,
  LockOpen,
} from "lucide-react";
import Link from "next/link";

import type {
  MyPreferenceSchedule,
  MyPreferenceScheduleItem,
  MyPreferencesPage,
} from "@/application/preferences/queries";
import { Badge } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { EmptyState } from "@/components/ui/empty-state";
import type { IsoDate } from "@/domain/shared/dates";
import {
  faNumber,
  formatJalaliDateTime,
  formatJalaliRange,
  jalaliMonthLabel,
  jalaliMonthParam,
  type JalaliMonth,
} from "@/features/calendar/jalali";
import { myShiftsHref } from "@/features/my-shifts/presentation";
import {
  MonthNavLink,
  type MonthLink,
} from "@/features/schedule-review/month-calendar";
import { ShiftChip } from "@/features/shifts/shift-chip";
import { APP_TIMEZONE } from "@/infrastructure/auth/actor";
import { cn } from "@/lib/utils";

import { DateBlock } from "./date-block";
import { PreferenceMonthEditor } from "./preference-month-editor";
import { PreferenceSummary } from "./preference-summary";
import {
  MONTH_STATE_LABEL,
  NO_PREFERENCE,
  closedMonthHeadline,
  countPreferences,
  dayView,
  daysWithPreference,
  groupDays,
  initiallyOpenGroup,
  monthOfPeriod,
  preferencesHref,
} from "./presentation";

export const MONTH_HEADING_ID = "preference-month";

const focusRing =
  "focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-none";

/** «باز برای ثبت» or «بسته», in words and with an icon (never color alone). */
function MonthStateBadge({ open }: { open: boolean }) {
  return open ? (
    <Badge tone="active" icon={LockOpen}>
      {MONTH_STATE_LABEL.OPEN}
    </Badge>
  ) : (
    <Badge tone="muted" icon={Lock}>
      {MONTH_STATE_LABEL.CLOSED}
    </Badge>
  );
}

/**
 * The month being shown, previous / next calendar month around it (every
 * month can be visited, open or not), the schedule's department and
 * deadline, and shortcuts to the other months that have preferences.
 */
function MonthHeader({
  month,
  previous,
  next,
  page,
}: {
  month: JalaliMonth;
  previous: MonthLink | null;
  next: MonthLink | null;
  page: MyPreferencesPage;
}) {
  const { selected, monthSchedules } = page;
  const current = jalaliMonthParam(month);
  const shortcuts = page.schedules.filter(
    (s) => jalaliMonthParam(monthOfPeriod(s.period)) !== current,
  );
  return (
    <section
      aria-labelledby={MONTH_HEADING_ID}
      className="overflow-hidden rounded-xl border border-primary/15 bg-card shadow-sm shadow-primary/5"
    >
      <div className="flex items-center gap-2 p-3">
        <MonthNavLink direction="previous" target={previous} />
        <div className="flex min-w-0 flex-1 flex-col items-center gap-1">
          <h2
            id={MONTH_HEADING_ID}
            className="text-center text-xl leading-snug font-bold"
          >
            {jalaliMonthLabel(month)}
          </h2>
          {selected && <MonthStateBadge open={selected.editable} />}
        </div>
        <MonthNavLink direction="next" target={next} />
      </div>
      {(selected || shortcuts.length > 0) && (
        <div className="flex flex-col gap-2 border-t border-primary/10 bg-brand-soft/50 px-3 py-2.5 text-sm">
          {selected && (
            <ScheduleFacts schedule={selected} others={monthSchedules} />
          )}
          {shortcuts.length > 0 && (
            <nav
              aria-label="ماه‌های دیگر با ثبت ترجیحات"
              className="flex flex-wrap items-center gap-x-2 gap-y-1"
            >
              <span className="text-muted-foreground">ماه‌های دیگر:</span>
              {shortcuts.map((s) => (
                <Link
                  key={s.id}
                  href={preferencesHref(monthOfPeriod(s.period))}
                  className={cn(
                    "inline-flex min-h-9 items-center gap-1 rounded-md px-1.5 font-medium text-primary underline-offset-4 hover:underline pointer-coarse:min-h-11",
                    focusRing,
                  )}
                >
                  {jalaliMonthLabel(monthOfPeriod(s.period))}
                  <span className="text-xs font-normal text-muted-foreground">
                    ({MONTH_STATE_LABEL[s.state]})
                  </span>
                </Link>
              ))}
            </nav>
          )}
        </div>
      )}
    </section>
  );
}

/** Department, date range and deadline; a switcher when two departments share the month. */
function ScheduleFacts({
  schedule,
  others,
}: {
  schedule: MyPreferenceSchedule;
  others: readonly MyPreferenceScheduleItem[];
}) {
  const { window } = schedule;
  return (
    <div className="flex flex-col gap-1.5">
      {others.length > 1 ? (
        <nav aria-label="برنامه‌های این ماه">
          <ul className="flex flex-wrap gap-1.5">
            {others.map((s) => {
              const current = s.id === schedule.id;
              return (
                <li key={s.id} className="min-w-0">
                  <Link
                    href={preferencesHref(monthOfPeriod(s.period), s.id)}
                    aria-current={current ? "page" : undefined}
                    className={cn(
                      "inline-flex min-h-11 max-w-full items-center gap-1.5 rounded-md border px-3 text-start",
                      focusRing,
                      current
                        ? "border-primary bg-primary text-primary-foreground"
                        : "bg-background hover:bg-accent",
                    )}
                  >
                    <span className="truncate">{s.departmentName}</span>
                    <span className="text-xs opacity-80">
                      ({MONTH_STATE_LABEL[s.state]})
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      ) : (
        <p className="font-medium">{schedule.departmentName}</p>
      )}
      <p className="flex flex-wrap gap-x-3 gap-y-0.5 text-muted-foreground">
        <span>
          بازه ثبت: {formatJalaliRange(window.firstDate, window.lastDate)} (
          {faNumber(window.dateCount)} روز)
        </span>
        {window.closesAt && (
          <span>
            مهلت ثبت: {formatJalaliDateTime(window.closesAt, APP_TIMEZONE)}
          </span>
        )}
        {window.closedAt && (
          <span>
            بسته شده: {formatJalaliDateTime(window.closedAt, APP_TIMEZONE)}
          </span>
        )}
      </p>
    </div>
  );
}

/**
 * A month that can no longer be edited: one clear message, the nurse's
 * preferences as a read-only summary (never thirty disabled forms), and the
 * way to their shifts of the same month. Closing never deletes anything:
 * if collection reopens, the same values come back editable.
 */
function ClosedMonth({
  schedule,
  today,
}: {
  schedule: MyPreferenceSchedule;
  today: IsoDate;
}) {
  const headline =
    closedMonthHeadline(schedule.days.map((d) => d.lock)) ??
    MONTH_STATE_LABEL.CLOSED;
  const chosen = daysWithPreference(schedule.days);
  const counts = countPreferences(schedule.days.map((d) => d.value));
  return (
    <div className="flex flex-col gap-4">
      <section
        aria-labelledby="closed-month"
        className="flex flex-col gap-3 rounded-lg border bg-muted/40 p-4"
      >
        <h2
          id="closed-month"
          className="flex items-start gap-2 leading-relaxed font-semibold"
        >
          <Lock aria-hidden="true" className="mt-1 size-4 shrink-0" />
          {headline}
        </h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          ترجیحات ثبت‌شده شما حفظ شده است و فقط قابل مشاهده است.
        </p>
        <Link
          href={myShiftsHref(jalaliMonthParam(monthOfPeriod(schedule.period)))}
          className={cn(buttonClasses("default"), "self-start")}
        >
          <CalendarDays aria-hidden="true" className="size-4" />
          مشاهده شیفت‌های من
        </Link>
      </section>
      <PreferenceSummary counts={counts} />
      <section
        aria-labelledby="submitted-preferences"
        className="flex flex-col gap-2 rounded-lg border bg-card p-3"
      >
        <h2 id="submitted-preferences" className="text-sm font-semibold">
          ترجیحات ثبت‌شده من
        </h2>
        {chosen.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            برای این ماه ترجیحی ثبت نکرده‌اید.
          </p>
        ) : (
          <ul className="grid gap-1.5 sm:grid-cols-2 xl:grid-cols-3">
            {chosen.map((day) => {
              const view = dayView(day, today);
              return (
                <li
                  key={day.date}
                  aria-label={view.fullLabel}
                  className="flex min-w-0 items-center gap-2.5 rounded-md border p-1.5"
                >
                  <DateBlock view={view} className="w-11 py-0.5" />
                  <span className="flex min-w-0 flex-1 items-center gap-2">
                    <span className="font-medium">ترجیح من:</span>
                    <ShiftChip code={day.value} size="sm" icon label />
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        {chosen.length > 0 && counts.none > 0 && (
          <p className="text-xs text-muted-foreground">
            سایر روزها: {NO_PREFERENCE}
          </p>
        )}
      </section>
    </div>
  );
}

function EditableMonth({
  schedule,
  today,
}: {
  schedule: MyPreferenceSchedule;
  today: IsoDate;
}) {
  const groups = groupDays(schedule.days, today);
  return (
    <div className="flex flex-col gap-3">
      <p className="flex items-start gap-2 text-sm leading-relaxed text-muted-foreground">
        <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        برای هر روز یک ترجیح انتخاب کنید؛ انتخاب بلافاصله ذخیره می‌شود. ثبت
        ترجیح اختیاری است و ترجیح، شیفت قطعی نیست.
      </p>
      <PreferenceMonthEditor
        scheduleId={schedule.id}
        groups={groups}
        initiallyOpen={initiallyOpenGroup(groups)}
      />
    </div>
  );
}

/**
 * The nurse's preference page: one calendar month at a time. An open month
 * is edited day by day; a closed one is a read-only summary.
 */
export function PreferencesView({
  page,
  month,
  previous,
  next,
  today,
}: {
  page: MyPreferencesPage;
  month: JalaliMonth;
  previous: MonthLink | null;
  next: MonthLink | null;
  today: IsoDate;
}) {
  const { selected } = page;
  const nothingAnywhere = !selected && page.schedules.length === 0;
  return (
    <div className="flex flex-col gap-4">
      {page.requestedNotFound && (
        <div role="alert">
          <Callout tone="attention" icon={CircleAlert}>
            برنامه‌ای که باز کردید پیدا نشد یا برای شما در دسترس نیست.
            {selected && " برنامه در دسترس شما نمایش داده شده است."}
          </Callout>
        </div>
      )}
      <MonthHeader month={month} previous={previous} next={next} page={page} />
      {!selected ? (
        <EmptyState
          icon={<CalendarClock aria-hidden="true" />}
          title={
            nothingAnywhere
              ? "در حال حاضر ثبت ترجیحات برای شما باز نیست"
              : `برای ${jalaliMonthLabel(month)} ثبت ترجیحات ندارید`
          }
          description={
            nothingAnywhere
              ? "وقتی سرپرستار ثبت ترجیحات ماه بعد را باز کند، از طریق اعلان‌ها باخبر می‌شوید و می‌توانید ترجیحات شیفت خود را اینجا ثبت کنید."
              : "ثبت ترجیحات این ماه برای شما باز نشده است. ماه‌های دیگر را از بالای صفحه ببینید."
          }
        />
      ) : selected.editable ? (
        <EditableMonth schedule={selected} today={today} />
      ) : (
        <ClosedMonth schedule={selected} today={today} />
      )}
    </div>
  );
}
