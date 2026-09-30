import {
  CalendarClock,
  CalendarDays,
  CircleAlert,
  Info,
  Lock,
  LockOpen,
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import type {
  MyPreferenceSchedule,
  MyPreferenceScheduleItem,
  MyPreferencesPage,
} from "@/application/preferences/queries";
import type { IsoDate } from "@/domain/shared/dates";
import {
  faNumber,
  formatJalaliDateTime,
  formatJalaliRange,
} from "@/features/calendar/jalali";
import { APP_TIMEZONE } from "@/infrastructure/auth/actor";
import { cn } from "@/lib/utils";

import { PreferenceDayEditor } from "./preference-day-editor";
import {
  LOCK_REASONS,
  NO_PREFERENCE,
  PREFERENCE_OPTIONS,
  groupIntoWeeks,
  scheduleLockMessage,
} from "./presentation";

const focusRing =
  "focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-none";

function StateBadge({ open }: { open: boolean }) {
  const Icon = open ? LockOpen : Lock;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium whitespace-nowrap",
        open
          ? "border-emerald-600/30 bg-emerald-600/10 text-emerald-800 dark:text-emerald-300"
          : "bg-muted text-foreground",
      )}
    >
      <Icon aria-hidden="true" className="size-3.5" />
      {open ? "باز — قابل ویرایش" : "بسته — فقط مشاهده"}
    </span>
  );
}

/** Links to the other visible schedules (two departments or two months). */
function ScheduleSwitcher({
  schedules,
  selectedId,
}: {
  schedules: readonly MyPreferenceScheduleItem[];
  selectedId: string;
}) {
  if (schedules.length < 2) return null;
  return (
    <nav aria-label="برنامه‌های قابل انتخاب" className="mb-4">
      <ul className="flex flex-wrap gap-2">
        {schedules.map((s) => {
          const current = s.id === selectedId;
          return (
            <li key={s.id} className="min-w-0">
              <Link
                href={`/preferences?schedule=${s.id}`}
                aria-current={current ? "page" : undefined}
                className={cn(
                  "inline-flex min-h-11 max-w-full items-center gap-2 rounded-md border px-3 text-start text-sm",
                  focusRing,
                  current
                    ? "border-primary bg-primary text-primary-foreground"
                    : "bg-background hover:bg-accent",
                )}
              >
                <span className="truncate">
                  {s.label} · {s.departmentName}
                </span>
                <span className="text-xs opacity-80">
                  ({s.state === "OPEN" ? "باز" : "بسته"})
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function Facts({ items }: { items: readonly [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
      {items.map(([term, value]) => (
        <div key={term} className="contents">
          <dt className="text-muted-foreground">{term}</dt>
          <dd className="min-w-0 font-medium break-words">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function ContextCard({ schedule }: { schedule: MyPreferenceSchedule }) {
  const open = schedule.editable;
  const { window } = schedule;
  const range = formatJalaliRange(window.firstDate, window.lastDate);
  return (
    <section
      aria-labelledby="preference-context"
      className="flex flex-col gap-4 rounded-lg border bg-card p-4"
    >
      <h2
        id="preference-context"
        className="flex items-center gap-2 font-semibold"
      >
        <CalendarDays
          aria-hidden="true"
          className="size-5 text-muted-foreground"
        />
        {schedule.label}
      </h2>
      <Facts
        items={[
          ["بخش", schedule.departmentName],
          ["ماه برنامه", schedule.label],
          ["ثبت ترجیحات", <StateBadge key="state" open={open} />],
          ["بازه مجاز", `${range} (${faNumber(window.dateCount)} روز)`],
          ...(window.closesAt
            ? ([
                [
                  "مهلت ثبت",
                  formatJalaliDateTime(window.closesAt, APP_TIMEZONE),
                ],
              ] as [string, ReactNode][])
            : []),
          ...(window.closedAt
            ? ([
                [
                  "بسته شده",
                  formatJalaliDateTime(window.closedAt, APP_TIMEZONE),
                ],
              ] as [string, ReactNode][])
            : []),
        ]}
      />
      <p className="flex items-start gap-2 text-sm leading-relaxed text-muted-foreground">
        <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        ترجیح شما یک درخواست است، نه شیفت قطعی. برنامه نهایی را سرپرستار تنظیم
        می‌کند.
      </p>
    </section>
  );
}

function SummaryCard({ schedule }: { schedule: MyPreferenceSchedule }) {
  const { summary, days } = schedule;
  return (
    <section
      aria-labelledby="preference-summary"
      className="flex flex-col gap-3 rounded-lg border bg-card p-4"
    >
      <h2 id="preference-summary" className="font-semibold">
        خلاصه ترجیحات من
      </h2>
      <p className="text-sm">
        تعداد ترجیحات ثبت‌شده:{" "}
        <span className="font-semibold">
          {faNumber(summary.total)} از {faNumber(days.length)} روز
        </span>
      </p>
      <ul
        aria-label="راهنما و تعداد هر ترجیح"
        className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-2"
      >
        {PREFERENCE_OPTIONS.map((o) => (
          <li
            key={o.value}
            className="flex min-w-0 items-center justify-between gap-2 rounded-md border px-2 py-1.5"
          >
            <span className="flex min-w-0 items-center gap-2">
              <span
                dir="ltr"
                className={cn(
                  "inline-flex min-w-9 justify-center rounded px-1.5 py-0.5 text-xs font-bold",
                  o.className,
                )}
              >
                {o.code}
              </span>
              <span className="truncate">{o.short}</span>
            </span>
            <span className="font-semibold tabular-nums">
              {faNumber(summary[o.value])}
            </span>
          </li>
        ))}
      </ul>
      <p className="text-xs leading-relaxed text-muted-foreground">
        ME یعنی شیفت طولانی (صبح + عصر). OFF یعنی درخواست استراحت در آن روز. این
        خلاصه فقط برای اطلاع شماست.
      </p>
    </section>
  );
}

function DayCard({
  scheduleId,
  view,
}: {
  scheduleId: string;
  view: ReturnType<
    typeof groupIntoWeeks<MyPreferenceSchedule["days"][number]>
  >[number]["days"][number];
}) {
  const { day } = view;
  return (
    <li
      aria-current={view.isToday ? "date" : undefined}
      aria-label={view.fullLabel}
      className={cn(
        "flex gap-3 rounded-lg border bg-card p-3",
        view.isToday && "border-primary ring-2 ring-primary/30",
        day.lock !== null && "bg-muted/40",
      )}
    >
      <div
        aria-hidden="true"
        className={cn(
          "flex w-14 shrink-0 flex-col items-center justify-center rounded-md py-1 text-center",
          view.isToday ? "bg-primary text-primary-foreground" : "bg-muted",
        )}
      >
        <span className="text-[0.7rem] leading-tight">{view.weekday}</span>
        <span className="text-xl leading-tight font-bold">
          {view.dayNumber}
        </span>
        <span className="text-[0.7rem] leading-tight">{view.monthName}</span>
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        {view.isToday && (
          <span className="text-xs font-semibold text-primary">امروز</span>
        )}
        <PreferenceDayEditor
          scheduleId={scheduleId}
          date={day.date}
          value={day.value}
          dayLabel={view.fullLabel}
          lockReason={day.lock === null ? null : LOCK_REASONS[day.lock]}
        />
      </div>
    </li>
  );
}

function WeekList({
  schedule,
  today,
}: {
  schedule: MyPreferenceSchedule;
  today: IsoDate;
}) {
  const weeks = groupIntoWeeks(schedule.days, today);
  return (
    <div className="flex flex-col gap-6">
      {weeks.map((week, i) => (
        <section key={week.key} aria-labelledby={`week-${week.key}`}>
          <h2
            id={`week-${week.key}`}
            className="mb-2 text-sm font-semibold text-muted-foreground"
          >
            هفته {faNumber(i + 1)}: {week.label}
          </h2>
          <ol className="grid gap-2 sm:max-lg:grid-cols-2 2xl:grid-cols-2">
            {week.days.map((view) => (
              <DayCard
                key={view.day.date}
                scheduleId={schedule.id}
                view={view}
              />
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}

function Notice({
  tone,
  children,
}: {
  tone: "warning" | "info";
  children: ReactNode;
}) {
  const Icon = tone === "warning" ? CircleAlert : Lock;
  return (
    <div
      role={tone === "warning" ? "alert" : "note"}
      className={cn(
        "mb-4 flex items-start gap-3 rounded-lg border p-4 text-sm leading-relaxed",
        tone === "warning"
          ? "border-amber-600/40 bg-amber-500/10"
          : "bg-muted/60",
      )}
    >
      <Icon aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
      <p>{children}</p>
    </div>
  );
}

function EmptyState() {
  return (
    <section
      aria-labelledby="no-preference-window"
      className="flex flex-col items-center gap-4 rounded-lg border border-dashed px-6 py-12 text-center"
    >
      <CalendarClock
        aria-hidden="true"
        className="size-10 text-muted-foreground"
      />
      <div className="flex max-w-md flex-col gap-2">
        <h2 id="no-preference-window" className="text-lg font-semibold">
          در حال حاضر ثبت ترجیحات برای شما باز نیست
        </h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          وقتی سرپرستار ثبت ترجیحات ماه بعد را باز کند، از طریق اعلان‌ها باخبر
          می‌شوید و می‌توانید ترجیحات شیفت خود را اینجا ثبت کنید.
        </p>
      </div>
    </section>
  );
}

/** The nurse's personal preference page: one schedule at a time. */
export function PreferencesView({
  page,
  today,
}: {
  page: MyPreferencesPage;
  today: IsoDate;
}) {
  const { selected } = page;
  const lockMessage = selected
    ? scheduleLockMessage(selected.days.map((d) => d.lock))
    : null;
  return (
    <>
      {page.requestedNotFound && (
        <Notice tone="warning">
          برنامه‌ای که باز کردید پیدا نشد یا برای شما در دسترس نیست.
          {selected && " برنامه در دسترس شما نمایش داده شده است."}
        </Notice>
      )}
      {!selected ? (
        <EmptyState />
      ) : (
        <>
          <ScheduleSwitcher
            schedules={page.schedules}
            selectedId={selected.id}
          />
          {lockMessage && <Notice tone="info">{lockMessage}</Notice>}
          {/* Mobile: context, days, then the summary. Desktop: days beside a side column. */}
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:grid-rows-[auto_1fr]">
            <div className="min-w-0 lg:col-start-2 lg:row-start-1">
              <ContextCard schedule={selected} />
            </div>
            <div className="min-w-0 lg:col-start-1 lg:row-span-2 lg:row-start-1">
              {selected.editable && (
                <p className="mb-3 text-sm leading-relaxed text-muted-foreground">
                  برای هر روز یک ترجیح انتخاب کنید؛ انتخاب شما بلافاصله ذخیره
                  می‌شود. روزهای بدون انتخاب «{NO_PREFERENCE}» می‌مانند.
                </p>
              )}
              <WeekList schedule={selected} today={today} />
            </div>
            <div className="min-w-0 lg:col-start-2 lg:row-start-2 lg:self-start">
              <SummaryCard schedule={selected} />
            </div>
          </div>
        </>
      )}
    </>
  );
}
