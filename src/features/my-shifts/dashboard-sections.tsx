import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  UsersRound,
  UserRoundX,
} from "lucide-react";
import Link from "next/link";

import type { NurseDashboard } from "@/application/my-shifts/dashboard";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { SectionHeader } from "@/components/ui/section-header";
import { addDays, type IsoDate } from "@/domain/shared/dates";
import {
  faDigits,
  faNumber,
  formatJalaliDate,
  formatJalaliRange,
  jalaliWeekday,
  toJalali,
} from "@/features/calendar/jalali";
import {
  CONSENT_STATUS,
  REQUEST_STATUS,
  REQUEST_TYPE_LABELS,
} from "@/features/change-requests/presentation";
import type { ShiftLabels } from "@/features/shifts/catalog";
import { ShiftChip } from "@/features/shifts/shift-chip";
import { cn } from "@/lib/utils";

import { weeklyHref } from "./dashboard-navigation";
import { DayDetail, MonthTotals, PublicationNotices } from "./my-shifts-view";
import { dayCellLabel, PUBLICATION_PRESENTATION } from "./presentation";
import { UNAPPROVED_CHIP } from "./shift-calendar";

const focusRing =
  "focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-none";

export function WeeklyCalendar({
  data,
  today,
  selected,
  shiftLabels,
}: {
  data: NurseDashboard;
  today: IsoDate;
  selected: IsoDate;
  shiftLabels: ShiftLabels;
}) {
  const { calendar } = data;
  if (!calendar.onAnyRoster)
    return (
      <EmptyState
        icon={<UserRoundX />}
        title="هنوز در برنامه هیچ بخشی نیستید"
        description="وقتی سرپرستار شما را در برنامه ماهانه بخش قرار دهد، شیفت‌هایتان اینجا نمایش داده می‌شود."
      />
    );
  const start = calendar.period.start;
  return (
    <>
      <section
        aria-labelledby="weekly-calendar"
        className="flex min-w-0 flex-col gap-3"
      >
        <SectionHeader
          id="weekly-calendar"
          title="برنامه هفت روز شما"
          icon={<CalendarDays aria-hidden="true" className="size-4" />}
        />
        <div className="overflow-hidden rounded-xl border bg-card">
          <div className="flex items-center gap-1 border-b p-2">
            <Link
              href={weeklyHref(addDays(start, -7))}
              aria-label="هفت روز قبل"
              scroll={false}
              className={buttonClasses("ghost", "shrink-0 px-2")}
            >
              <ChevronRight aria-hidden="true" className="size-4" />
            </Link>
            <p className="min-w-0 flex-1 text-center text-sm font-semibold">
              {formatJalaliRange(start, calendar.period.end)}
            </p>
            <Link
              href={weeklyHref(addDays(start, 7))}
              aria-label="هفت روز بعد"
              scroll={false}
              className={buttonClasses("ghost", "shrink-0 px-2")}
            >
              <ChevronLeft aria-hidden="true" className="size-4" />
            </Link>
          </div>
          <ol
            aria-label="تقویم هفتگی شیفت‌های شما"
            className="grid grid-cols-7"
          >
            {calendar.days.map((day) => (
              <li key={day.date} className="min-w-0 border-e last:border-e-0">
                <Link
                  href={weeklyHref(start, day.date)}
                  scroll={false}
                  prefetch={false}
                  aria-label={dayCellLabel(day, shiftLabels, {
                    selected: day.date === selected,
                  })}
                  aria-current={day.date === today ? "date" : undefined}
                  data-selected={day.date === selected || undefined}
                  data-date={day.date}
                  className={cn(
                    "flex min-h-28 min-w-0 flex-col items-center gap-2 px-0.5 py-3 text-center ring-inset",
                    focusRing,
                    day.date === selected
                      ? "bg-brand-soft ring-2 ring-primary"
                      : "hover:bg-accent",
                  )}
                >
                  <span className="text-[0.625rem] text-muted-foreground sm:text-xs">
                    {jalaliWeekday(day.date)}
                  </span>
                  <span
                    className={cn(
                      "flex size-7 items-center justify-center rounded-full text-lg font-bold tabular-nums",
                      day.date === today &&
                        "bg-primary text-primary-foreground",
                    )}
                  >
                    {faDigits(toJalali(day.date).day)}
                  </span>
                  {day.entries.length ? (
                    day.entries.map((entry) => (
                      <ShiftChip
                        key={entry.scheduleId}
                        code={entry.shift}
                        size="xs"
                        className={
                          PUBLICATION_PRESENTATION[entry.publication].unapproved
                            ? UNAPPROVED_CHIP
                            : undefined
                        }
                      />
                    ))
                  ) : (
                    <span className="text-[0.625rem] text-muted-foreground">
                      تعیین‌نشده
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ol>
        </div>
        {start !== today && (
          <Link
            href={weeklyHref(today)}
            scroll={false}
            className={cn(
              "inline-flex min-h-11 items-center self-start rounded-md text-sm font-medium text-primary",
              focusRing,
            )}
          >
            بازگشت به امروز
          </Link>
        )}
        {!calendar.onAnyRoster && (
          <p className="text-sm text-muted-foreground">
            هنوز در برنامه هیچ بخشی نیستید. پس از قرار گرفتن در برنامه،
            شیفت‌هایتان اینجا نمایش داده می‌شود.
          </p>
        )}
        {calendar.onAnyRoster && !calendar.schedules.length && (
          <p className="text-sm text-muted-foreground">
            برای این بازه هنوز برنامه‌ای برای شما وجود ندارد.
          </p>
        )}
      </section>
      <PublicationNotices schedules={calendar.schedules} />
      <DayDetail
        day={calendar.days.find((d) => d.date === selected) ?? null}
        today={today}
        schedules={calendar.schedules}
        shiftLabels={shiftLabels}
      />
    </>
  );
}

export function Coworkers({
  data,
  selected,
}: {
  data: NurseDashboard;
  selected: IsoDate | null;
}) {
  return (
    <section aria-labelledby="my-coworkers" className="flex flex-col gap-3">
      <SectionHeader
        id="my-coworkers"
        title="همکاران این شیفت"
        icon={<UsersRound aria-hidden="true" className="size-4" />}
      />
      <p className="text-sm text-muted-foreground">
        {selected
          ? formatJalaliDate(selected, { weekday: true })
          : "برای دیدن همکاران، روزی را در تقویم انتخاب کنید."}
      </p>
      {!selected ? null : !data.coworkers.length ? (
        <p className="text-sm text-muted-foreground">
          در این روز شیفت کاری ندارید؛ همکاران پس از انتخاب روزی با شیفت کاری
          نمایش داده می‌شوند.
        </p>
      ) : (
        data.coworkers.map((group) => (
          <div key={group.scheduleId} className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <ShiftChip code={group.shift} />
              <span>{group.departmentName}</span>
            </div>
            {!group.available ? (
              <p className="text-sm text-muted-foreground">
                همکاران پس از نهایی شدن برنامه، برای اعضای فعلی بخش قابل
                مشاهده‌اند.
              </p>
            ) : group.names.length ? (
              <ul
                aria-label={`همکاران ${group.departmentName}`}
                className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3"
              >
                {group.names.map((name, index) => (
                  <li
                    key={index}
                    className="min-w-0 rounded-lg border bg-card px-3 py-2 text-sm font-medium break-words"
                  >
                    {name}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">
                همکاری با ساعت کاری هم‌پوشان در این شیفت ثبت نشده است.
              </p>
            )}
          </div>
        ))
      )}
    </section>
  );
}

export function DashboardSummary({
  data,
  label,
  shiftLabels,
}: {
  data: NurseDashboard;
  label: string;
  shiftLabels: ShiftLabels;
}) {
  return (
    <section
      aria-labelledby="dashboard-summary"
      className="flex flex-col gap-3"
    >
      <SectionHeader id="dashboard-summary" title="خلاصه ماه" meta={label} />
      <MonthTotals totals={data.month.totals} shiftLabels={shiftLabels} />
      <p className="text-sm text-muted-foreground">
        {data.upcomingOffDates.length
          ? `${faNumber(data.upcomingOffDates.length)} روز استراحت پیش رو در این ماه: ${data.upcomingOffDates
              .slice(0, 3)
              .map((date) => formatJalaliDate(date))
              .join("، ")}${data.upcomingOffDates.length > 3 ? " و …" : ""}`
          : "در این ماه روز استراحت پیش رویی ثبت نشده است."}
      </p>
      <p className="text-xs text-muted-foreground">
        ساعت‌ها از برنامه شیفت محاسبه می‌شوند؛ بیانگر حضور واقعی یا حقوق نیستند.
      </p>
    </section>
  );
}

export function DashboardRequests({
  requests,
}: {
  requests: NurseDashboard["requests"];
}) {
  return (
    <section
      aria-labelledby="dashboard-requests"
      className="flex flex-col gap-3"
    >
      <SectionHeader
        id="dashboard-requests"
        title="درخواست‌های من"
        actions={
          <Link href="/requests" className={buttonClasses("outline")}>
            همه درخواست‌ها
          </Link>
        }
      />
      {requests.length ? (
        <ul className="divide-y rounded-xl border bg-card px-3">
          {requests.map((request) => (
            <li
              key={request.id}
              className="flex flex-wrap items-center gap-2 py-3 text-sm"
            >
              <span className="font-medium">
                {REQUEST_TYPE_LABELS[request.type]}
              </span>
              <span className="text-muted-foreground">
                {formatJalaliDate(request.date)}
              </span>
              <Badge tone={REQUEST_STATUS[request.status].tone}>
                {REQUEST_STATUS[request.status].label}
              </Badge>
              {request.status === "PENDING" && request.consent && (
                <Badge tone={CONSENT_STATUS[request.consent].tone}>
                  {CONSENT_STATUS[request.consent].label}
                </Badge>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">
          هنوز درخواستی ثبت نشده است. درخواست‌های اخیر شما اینجا نمایش داده
          می‌شوند.
        </p>
      )}
    </section>
  );
}
