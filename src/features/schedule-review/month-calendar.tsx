import { ChevronLeft, ChevronRight, CircleAlert, Info } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";

import type {
  ReviewDay,
  ScheduleMonthReview,
} from "@/application/schedules/review";
import type { DayHealth } from "@/domain/schedule/day-health";
import { COVERAGE_PERIODS } from "@/domain/shifts/shift-type";
import type { IsoDate } from "@/domain/shared/dates";
import {
  faDigits,
  faNumber,
  jalaliWeekday,
  toJalali,
} from "@/features/calendar/jalali";
import { monthGrid } from "@/features/calendar/month-grid";
import { SHIFT_PRESENTATION } from "@/features/shifts/catalog";
import { cn } from "@/lib/utils";

import { HealthIcon } from "./health-icon";
import { LinkPending } from "./link-pending";
import {
  HEALTH_PRESENTATION,
  HOLIDAY_LABEL,
  VALID_CAVEAT,
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
export function MonthNavLink({
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
    "inline-flex size-11 shrink-0 items-center justify-center rounded-md border md:size-9 pointer-coarse:size-11",
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

const findingCount = (day: ReviewDay) =>
  day.findings.blocking + day.findings.other;

/** "پنجشنبه ۷" for the attention-day links. */
const shortDay = (date: IsoDate) =>
  `${jalaliWeekday(date)} ${faDigits(toJalali(date).day)}`;

/** The order the month summary lists states in: what needs work first. */
const SUMMARY_ORDER: readonly DayHealth[] = [
  "NEEDS_ATTENTION",
  "UNPLANNED",
  "VALID",
];

/**
 * The month at a glance, above the calendar: days per health state, then a
 * link to every day that needs attention (so "which days need me" is one
 * row, not a scan of 30 cells; on phones especially). Aggregates only.
 */
export function MonthSummary({
  month,
  dayHref,
}: {
  month: ScheduleMonthReview;
  dayHref: (date: IsoDate) => Route;
}) {
  const attention = month.days.filter((d) => d.health === "NEEDS_ATTENTION");
  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-card px-3 py-2.5 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-6">
      <ul
        aria-label="خلاصه وضعیت روزهای ماه"
        className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm"
      >
        {SUMMARY_ORDER.map((state) => {
          const n = month.totals[state];
          const loud = state === "NEEDS_ATTENTION" && n > 0;
          return (
            <li
              key={state}
              data-health={state}
              className={cn(
                "inline-flex items-center gap-1.5",
                loud
                  ? "font-semibold text-health-attention-foreground"
                  : "text-muted-foreground",
              )}
            >
              <HealthIcon
                health={state}
                className={cn(!loud && "text-muted-foreground")}
              />
              <span>{HEALTH_PRESENTATION[state].label}:</span>{" "}
              <span
                className={cn(
                  "tabular-nums",
                  loud ? "text-current" : "font-semibold text-foreground",
                )}
              >
                {dayCount(n)}
              </span>
            </li>
          );
        })}
      </ul>
      {attention.length > 0 && (
        <nav
          aria-label="روزهای نیازمند بررسی"
          className="flex min-w-0 flex-wrap items-center gap-1.5 sm:border-s sm:ps-6"
        >
          <span className="text-xs text-muted-foreground">رفتن به:</span>
          {attention.map((d) => (
            <Link
              key={d.date}
              href={dayHref(d.date)}
              scroll={false}
              prefetch={false}
              aria-label={dayCellLabel(d)}
              className={cn(
                "inline-flex min-h-8 items-center gap-1 rounded-full border border-health-attention/50 bg-health-attention/10 px-2.5 text-xs font-medium text-health-attention-foreground hover:bg-health-attention/20 pointer-coarse:min-h-10",
                focusRing,
              )}
            >
              <CircleAlert aria-hidden="true" className="size-3.5" />
              {shortDay(d.date)}
              <span className="tabular-nums opacity-80">
                ({faNumber(findingCount(d))})
              </span>
            </Link>
          ))}
        </nav>
      )}
    </div>
  );
}

/** The top line of a cell: day number, holiday tag, health marker. */
function CellTop({
  cell,
  today,
}: {
  cell: { date: IsoDate; dayNumber: string; data: ReviewDay };
  today: IsoDate;
}) {
  const day = cell.data;
  const findings = findingCount(day);
  return (
    <span aria-hidden="true" className="flex items-start justify-between gap-1">
      <span className="flex min-w-0 items-center gap-1">
        <span
          className={cn(
            "inline-flex size-6 shrink-0 items-center justify-center rounded-full text-sm leading-none font-semibold tabular-nums",
            day.health === "UNPLANNED" && "text-muted-foreground",
            day.holiday && "text-holiday-foreground",
            cell.date === today && "bg-primary text-primary-foreground",
          )}
        >
          {cell.dayNumber}
        </span>
        {day.holiday && (
          <span className="truncate rounded bg-holiday/15 px-1 text-[0.6875rem] leading-5 font-medium text-holiday-foreground">
            <span className="max-sm:hidden">تعطیل</span>
            <span className="sm:hidden">ت</span>
          </span>
        )}
      </span>
      {day.health === "NEEDS_ATTENTION" ? (
        <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-health-attention/20 px-1 text-xs leading-5 font-semibold text-health-attention-foreground sm:px-1.5">
          <CircleAlert className="size-3.5" />
          <span className="tabular-nums max-sm:hidden">
            {faNumber(findings)}
          </span>
        </span>
      ) : (
        <HealthIcon
          health={day.health}
          className={cn(
            "mt-1 size-3.5",
            day.health === "VALID"
              ? "text-health-valid-foreground/70"
              : "text-muted-foreground/60",
          )}
        />
      )}
    </span>
  );
}

/**
 * Coverage per period (M, E, N; ME counts toward M and E), the reason to
 * scan the calendar: the numbers are the cell's content, the codes are
 * small and tinted only by text color. From `md` up.
 */
function CellCoverage({ day }: { day: ReviewDay }) {
  if (day.health === "UNPLANNED")
    return (
      <span
        aria-hidden="true"
        className="mt-auto text-[0.6875rem] text-muted-foreground max-md:hidden"
      >
        بدون شیفت
      </span>
    );
  return (
    <span
      aria-hidden="true"
      className="mt-auto grid max-w-36 grid-cols-3 gap-0.5 text-center max-md:hidden"
    >
      {COVERAGE_PERIODS.map((p) => (
        <span key={p} className="flex min-w-0 flex-col leading-tight">
          <span
            dir="ltr"
            className={cn(
              "text-[0.625rem] font-bold",
              SHIFT_PRESENTATION[p].accentClass,
            )}
          >
            {p}
          </span>
          <span className="text-sm font-semibold tabular-nums">
            {faNumber(day.coverage[p])}
          </span>
        </span>
      ))}
    </span>
  );
}

const HOVER: Record<DayHealth, string> = {
  UNPLANNED: "hover:bg-accent",
  VALID: "hover:bg-accent",
  NEEDS_ATTENTION: "hover:bg-health-attention/15",
};

/**
 * Layer 1 of the Head Nurse review: the whole month as a Saturday-first
 * calendar on a hairline grid. Each in-period day links to its detail
 * (`?day=`); days that only complete the first or last week are muted and
 * inert. A cell carries only aggregates (health, coverage counts, holiday),
 * never nurse data. Quiet by default, loud on exceptions: a VALID day adds
 * nothing but a small check, a day needing attention is tinted, outlined
 * and counted.
 */
export function MonthCalendar({
  month,
  today,
  dayHref,
  selected,
}: {
  month: ScheduleMonthReview;
  today: IsoDate;
  dayHref: (date: IsoDate) => Route;
  /** The day open in the day detail, if any. */
  selected?: IsoDate | null;
}) {
  const grid = monthGrid(month.period, month.days);
  const hasHoliday = month.days.some((d) => d.holiday);
  return (
    <section aria-label="تقویم ماه" className="flex flex-col gap-2">
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

      <div className="overflow-hidden rounded-lg border bg-card">
        <table className="w-full table-fixed border-separate border-spacing-0">
          <caption className="sr-only">
            تقویم {month.label}؛ برای دیدن و ویرایش شیفت‌ها و موارد نیازمند
            بررسی، روز را انتخاب کنید.
          </caption>
          <thead>
            <tr>
              {grid.weekdays.map((w) => (
                <th
                  key={w.long}
                  scope="col"
                  abbr={w.long}
                  className="border-b bg-muted/50 py-2 text-xs font-medium text-muted-foreground"
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
              <tr key={week[0]!.date} className="[&:last-child>td]:border-b-0">
                {week.map((cell) => (
                  <td
                    key={cell.date}
                    className={cn(
                      "h-14 border-e border-b p-0 align-top last:border-e-0 sm:h-16 md:h-[5.5rem] xl:h-24",
                      !cell.data && "bg-muted/40",
                    )}
                  >
                    {cell.data ? (
                      <Link
                        id={`day-${cell.date}`}
                        href={dayHref(cell.date)}
                        scroll={false}
                        prefetch={false}
                        aria-label={dayCellLabel(cell.data)}
                        aria-current={cell.date === today ? "date" : undefined}
                        data-health={cell.data.health}
                        data-selected={cell.date === selected || undefined}
                        className={cn(
                          "relative flex h-full min-w-0 flex-col gap-1 p-1 transition-colors focus-visible:ring-inset sm:p-1.5",
                          focusRing,
                          HEALTH_PRESENTATION[cell.data.health].cellClass,
                          HOVER[cell.data.health],
                          cell.date === selected &&
                            "ring-2 ring-foreground ring-inset",
                        )}
                      >
                        <CellTop
                          cell={{ ...cell, data: cell.data }}
                          today={today}
                        />
                        <CellCoverage day={cell.data} />
                        <LinkPending />
                      </Link>
                    ) : (
                      <span
                        aria-hidden="true"
                        className="flex h-full p-1 text-sm text-muted-foreground/50 tabular-nums sm:p-1.5"
                      >
                        <span className="inline-flex size-6 items-center justify-center">
                          {cell.dayNumber}
                        </span>
                      </span>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <CalendarLegend hasHoliday={hasHoliday} />
    </section>
  );
}

/**
 * One compact legend: what the numbers are, the three health markers, and
 * what VALID does not mean. The holiday entry only when the month has one
 * (no holiday source is connected yet, D41).
 */
function CalendarLegend({ hasHoliday }: { hasHoliday: boolean }) {
  return (
    <div className="flex flex-col gap-1.5 text-xs leading-relaxed text-muted-foreground">
      <p className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="inline-flex items-center gap-1.5 max-md:hidden">
          {COVERAGE_PERIODS.map((p) => (
            <span
              key={p}
              dir="ltr"
              className={cn("font-bold", SHIFT_PRESENTATION[p].accentClass)}
            >
              {p}
            </span>
          ))}
          <span>
            تعداد نفرات در پوشش صبح، عصر و شب (شیفت طولانی در صبح و عصر شمرده
            می‌شود)
          </span>
        </span>
        {(["NEEDS_ATTENTION", "VALID", "UNPLANNED"] as const).map((state) => (
          <span key={state} className="inline-flex items-center gap-1">
            <HealthIcon health={state} className="size-3.5" />
            {HEALTH_PRESENTATION[state].label}
          </span>
        ))}
        {hasHoliday && (
          <span className="inline-flex items-center gap-1.5">
            <span className="rounded bg-holiday/15 px-1 leading-5 font-medium text-holiday-foreground">
              تعطیل
            </span>
            {HOLIDAY_LABEL}
          </span>
        )}
      </p>
      <p>{VALID_CAVEAT}</p>
    </div>
  );
}
