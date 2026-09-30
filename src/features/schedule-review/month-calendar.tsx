import { CalendarCheck2, ChevronLeft, ChevronRight, Info } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";

import type { ScheduleMonthReview } from "@/application/schedules/review";
import { DAY_HEALTH_STATES } from "@/domain/schedule/day-health";
import { COVERAGE_PERIODS } from "@/domain/shifts/shift-type";
import type { IsoDate } from "@/domain/shared/dates";
import { faNumber } from "@/features/calendar/jalali";
import { monthGrid } from "@/features/calendar/month-grid";
import { SHIFT_PRESENTATION } from "@/features/shifts/catalog";
import { cn } from "@/lib/utils";

import { HealthIcon } from "./health-icon";
import {
  HEALTH_PRESENTATION,
  HOLIDAY_LABEL,
  dayCellLabel,
  dayCount,
} from "./presentation";

const focusRing =
  "focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-none";

export interface MonthLink {
  readonly href: Route;
  readonly label: string;
}

/**
 * Previous / next calendar month: the only month navigation. Purely
 * temporal (a month without a schedule is still a destination); `target` is
 * null only past the supported years, where the control is disabled.
 */
function MonthNavLink({
  direction,
  target,
}: {
  direction: "previous" | "next";
  target: MonthLink | null;
}) {
  // RTL: the earlier month is at the start (right), so it points right.
  const Icon = direction === "previous" ? ChevronRight : ChevronLeft;
  const text = direction === "previous" ? "ماه قبل" : "ماه بعد";
  const base = cn(
    "inline-flex size-11 items-center justify-center rounded-md border",
    focusRing,
  );
  if (!target)
    return (
      <button
        type="button"
        disabled
        aria-label={`${text} (خارج از بازه پشتیبانی‌شده)`}
        className={cn(base, "cursor-not-allowed opacity-40")}
      >
        <Icon aria-hidden="true" className="size-5" />
      </button>
    );
  return (
    <Link
      href={target.href}
      aria-label={`${text}: ${target.label}`}
      title={target.label}
      className={cn(base, "bg-background hover:bg-accent")}
    >
      <Icon aria-hidden="true" className="size-5" />
    </Link>
  );
}

/** The calendar header: previous month, the month's name, next month. */
export function MonthHeader({
  label,
  headingId,
  previous,
  next,
}: {
  label: string;
  headingId: string;
  previous: MonthLink | null;
  next: MonthLink | null;
}) {
  return (
    <div className="flex items-center gap-2">
      <MonthNavLink direction="previous" target={previous} />
      <div className="flex min-w-0 flex-1 flex-col items-center text-center">
        <h2
          id={headingId}
          className="flex items-center gap-2 text-sm font-medium text-muted-foreground"
        >
          <CalendarCheck2 aria-hidden="true" className="size-4 shrink-0" />
          مرور ماهانه
        </h2>
        <p className="truncate text-lg font-bold">{label}</p>
      </div>
      <MonthNavLink direction="next" target={next} />
    </div>
  );
}

/** Health states with this month's day counts; doubles as the legend. */
function HealthTotals({ month }: { month: ScheduleMonthReview }) {
  return (
    <ul
      aria-label="خلاصه وضعیت روزهای ماه"
      className="flex flex-wrap gap-2 text-sm"
    >
      {DAY_HEALTH_STATES.map((state) => (
        <li
          key={state}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1",
            HEALTH_PRESENTATION[state].badgeClass,
          )}
        >
          <HealthIcon health={state} />
          <span>{HEALTH_PRESENTATION[state].label}:</span>{" "}
          <span className="font-semibold">{dayCount(month.totals[state])}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Layer 1 of the Head Nurse review: the whole month as a Saturday-first
 * calendar. Each in-period day links to its detail (`?day=`); days that only
 * complete the first or last week are dimmed and inert. A cell carries only
 * aggregates (health, coverage counts, holiday), never nurse data.
 */
export function MonthCalendar({
  month,
  today,
  dayHref,
  previous,
  next,
}: {
  month: ScheduleMonthReview;
  today: IsoDate;
  dayHref: (date: IsoDate) => Route;
  previous: MonthLink | null;
  next: MonthLink | null;
}) {
  const grid = monthGrid(month.period, month.days);
  return (
    <section
      aria-labelledby="month-calendar-heading"
      className="flex flex-col gap-4 rounded-lg border bg-card p-3 sm:p-5"
    >
      <MonthHeader
        label={month.label}
        headingId="month-calendar-heading"
        previous={previous}
        next={next}
      />

      <HealthTotals month={month} />

      {month.unattributedFindings > 0 && (
        <p
          role="note"
          className="flex items-start gap-2 rounded-md border border-health-attention/50 bg-health-attention/10 p-3 text-sm"
        >
          <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {faNumber(month.unattributedFindings)} مورد نیاز به بررسی مربوط به
          شیفت‌هایی خارج از روزهای این برنامه است.
        </p>
      )}

      <table className="w-full table-fixed border-separate border-spacing-1">
        <caption className="sr-only">
          تقویم {month.label}؛ برای دیدن شیفت‌ها و موارد نیازمند بررسی، روز را
          انتخاب کنید.
        </caption>
        <thead>
          <tr>
            {grid.weekdays.map((w) => (
              <th
                key={w.long}
                scope="col"
                abbr={w.long}
                className="pb-1 text-xs font-medium text-muted-foreground"
              >
                <span className="sm:hidden" aria-hidden="true">
                  {w.short}
                </span>
                <span className="max-sm:sr-only">{w.long}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {grid.weeks.map((week) => (
            <tr key={week[0]!.date}>
              {week.map((cell) => (
                <td key={cell.date} className="h-16 p-0 align-top sm:h-24">
                  {cell.data ? (
                    <Link
                      id={`day-${cell.date}`}
                      href={dayHref(cell.date)}
                      scroll={false}
                      prefetch={false}
                      aria-label={dayCellLabel(cell.data)}
                      aria-current={cell.date === today ? "date" : undefined}
                      data-health={cell.data.health}
                      className={cn(
                        "flex h-full min-w-0 flex-col gap-1 rounded-md border border-s-4 p-1 hover:bg-accent sm:p-1.5",
                        focusRing,
                        HEALTH_PRESENTATION[cell.data.health].cellClass,
                      )}
                    >
                      <span
                        aria-hidden="true"
                        className="flex items-start justify-between gap-1"
                      >
                        <span
                          className={cn(
                            "inline-flex min-w-6 justify-center rounded-full text-sm leading-6 font-semibold",
                            cell.date === today &&
                              "bg-primary text-primary-foreground",
                            cell.data.holiday && "text-holiday-foreground",
                          )}
                        >
                          {cell.dayNumber}
                        </span>
                        {cell.data.holiday && (
                          <span className="rounded bg-holiday/15 px-1 text-[0.65rem] leading-5 font-medium text-holiday-foreground">
                            <span className="max-sm:hidden">تعطیل</span>
                            <span className="sm:hidden">ت</span>
                          </span>
                        )}
                      </span>
                      <span
                        aria-hidden="true"
                        className="mt-auto flex min-w-0 items-center gap-1"
                      >
                        <HealthIcon health={cell.data.health} />
                        {cell.data.findings.blocking +
                          cell.data.findings.other >
                          0 && (
                          <span className="text-xs font-semibold text-health-attention-foreground">
                            {faNumber(
                              cell.data.findings.blocking +
                                cell.data.findings.other,
                            )}
                          </span>
                        )}
                        <span className="truncate text-xs text-muted-foreground max-lg:hidden">
                          {HEALTH_PRESENTATION[cell.data.health].label}
                        </span>
                      </span>
                      {cell.data.health !== "UNPLANNED" && (
                        <span
                          aria-hidden="true"
                          className="flex gap-0.5 max-xl:hidden"
                        >
                          {COVERAGE_PERIODS.map((p) => (
                            <span
                              key={p}
                              dir="ltr"
                              className={cn(
                                "rounded px-1 text-[0.65rem] leading-4 font-semibold",
                                SHIFT_PRESENTATION[p].tokenClass,
                              )}
                            >
                              {p} {faNumber(cell.data!.coverage[p])}
                            </span>
                          ))}
                        </span>
                      )}
                    </Link>
                  ) : (
                    <span
                      aria-hidden="true"
                      className="flex h-full rounded-md p-1 text-sm text-muted-foreground/50 sm:p-1.5"
                    >
                      {cell.dayNumber}
                    </span>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="rounded bg-holiday/15 px-1 leading-5 font-medium text-holiday-foreground">
            تعطیل
          </span>
          {HOLIDAY_LABEL}
        </span>
        <span className="max-xl:hidden">
          اعداد M / E / N: تعداد نفرات در پوشش صبح، عصر و شب (شیفت طولانی در صبح
          و عصر شمرده می‌شود).
        </span>
        <span>
          «{HEALTH_PRESENTATION.VALID.label}» فقط یعنی در قوانین پیاده‌سازی‌شده
          فعلی موردی یافت نشد؛ تأمین نفرات هنوز بررسی نمی‌شود.
        </span>
        <span>روزهای کم‌رنگ متعلق به ماه قبل یا بعد هستند.</span>
      </p>
    </section>
  );
}
