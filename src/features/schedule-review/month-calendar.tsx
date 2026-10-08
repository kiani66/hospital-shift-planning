import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  FilterX,
  Info,
  ListChecks,
} from "lucide-react";
import type { Route } from "next";
import Link from "next/link";

import type {
  PinnedRuleSetSummary,
  ReviewDay,
  ScheduleMonthReview,
} from "@/application/schedules/review";
import type { DayState } from "@/domain/rules/validation-summary";
import { COVERAGE_PERIODS } from "@/domain/shifts/shift-type";
import type { IsoDate } from "@/domain/shared/dates";
import { faNumber } from "@/features/calendar/jalali";
import { monthGrid } from "@/features/calendar/month-grid";
import {
  SHIFT_PRESENTATION,
  type ShiftLabels,
} from "@/features/shifts/catalog";
import { cn } from "@/lib/utils";

import { DayStateIcon } from "./day-state-icon";
import { LinkPending } from "./link-pending";
import {
  CATEGORY_LABELS,
  DAY_FILTER_LABELS,
  DAY_FILTERS,
  DAY_STATE_PRESENTATION,
  HOLIDAY_LABEL,
  dayCellLabel,
  dayCount,
  matchesDayFilter,
  validationSummaryText,
  type DayFilter,
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
    "inline-flex size-11 shrink-0 items-center justify-center rounded-md border border-input md:size-9 pointer-coarse:size-11",
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
      className={cn(
        base,
        "bg-background text-foreground shadow-xs transition-colors hover:border-primary/40 hover:bg-accent hover:text-accent-foreground",
      )}
    >
      <Icon aria-hidden="true" className="size-5" />
    </Link>
  );
}

/** The pinned rule-set version as the Head Nurse reads it (D106). */
export function ruleSetLabel(ruleSet: PinnedRuleSetSummary): string {
  const scope =
    ruleSet.departmentId === null ? "پیش‌فرض بیمارستان" : "قوانین ویژه بخش";
  return `${scope} · نسخه ${faNumber(ruleSet.versionNo)}`;
}

/**
 * The month at a glance, above the calendar (D104): whether the schedule is
 * ready to finalize and, when not, what is open per category (undecided
 * decisions, coverage problems split into shortages and overstaffing, rule
 * violations, ready days), never one "blocking conflicts" number. Each
 * category is a filter that marks its days in the calendar; filters never
 * write. Aggregates only.
 */
export function MonthSummary({
  month,
  filter = null,
  filterHref,
  ruleSetHref,
}: {
  month: ScheduleMonthReview;
  /** The active calendar filter, if any. */
  filter?: DayFilter | null;
  /** Where a filter chip leads (null clears the filter); none: no chips. */
  filterHref?: (filter: DayFilter | null) => Route;
  /** The pinned version's read-only page, when the viewer may open it. */
  ruleSetHref?: Route;
}) {
  const v = month.validation;
  const text = validationSummaryText(v);
  const daysFor = (f: DayFilter) =>
    month.days.filter((d) => matchesDayFilter(f, d)).length;
  const chips = DAY_FILTERS.filter((f) => daysFor(f) > 0);
  return (
    <section
      aria-labelledby="month-validation-title"
      data-validation={v.ready ? "ready" : "blocked"}
      className={cn(
        "flex flex-col gap-2 rounded-xl border px-3 py-2.5 shadow-xs",
        v.ready ? "border-health-valid/35 bg-health-valid/5" : "bg-card",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2
          id="month-validation-title"
          className="flex items-center gap-2 text-sm font-semibold"
        >
          {v.ready ? (
            <CircleCheck
              aria-hidden="true"
              className="size-4 text-health-valid-foreground"
            />
          ) : (
            <ListChecks aria-hidden="true" className="size-4 text-primary" />
          )}
          {text.title}
        </h2>
        <span className="text-xs text-muted-foreground">
          قوانین پوشش:{" "}
          {ruleSetHref ? (
            <Link
              href={ruleSetHref}
              className={cn(
                "rounded-sm font-medium text-primary underline-offset-4 hover:underline",
                focusRing,
              )}
            >
              {ruleSetLabel(month.ruleSet)}
            </Link>
          ) : (
            <span className="font-medium text-foreground">
              {ruleSetLabel(month.ruleSet)}
            </span>
          )}
        </span>
      </div>
      <ul
        aria-label="خلاصه اعتبارسنجی برنامه"
        className="flex flex-wrap gap-x-5 gap-y-1 text-sm"
      >
        {text.lines.map((line) => (
          <li key={line} className="tabular-nums">
            {line}
          </li>
        ))}
      </ul>
      {filterHref && chips.length > 0 && (
        <nav
          aria-label="نمایش روزها بر اساس دسته"
          className="flex min-w-0 flex-wrap items-center gap-1.5 border-t pt-2"
        >
          <span className="text-xs text-muted-foreground">نمایش روزهای:</span>
          {chips.map((f) => {
            const on = filter === f;
            return (
              <Link
                key={f}
                href={filterHref(on ? null : f)}
                scroll={false}
                prefetch={false}
                aria-current={on ? "true" : undefined}
                data-filter={f}
                className={cn(
                  "inline-flex min-h-8 items-center gap-1 rounded-full border px-2.5 text-xs font-medium transition-colors pointer-coarse:min-h-10",
                  focusRing,
                  on
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-input bg-background hover:border-primary/35 hover:bg-accent",
                )}
              >
                {DAY_FILTER_LABELS[f]}
                <span className="font-normal tabular-nums">
                  ({dayCount(daysFor(f))})
                </span>
              </Link>
            );
          })}
          {filter && (
            <Link
              href={filterHref(null)}
              scroll={false}
              prefetch={false}
              className={cn(
                "inline-flex min-h-8 items-center gap-1 rounded-full px-2.5 text-xs text-muted-foreground hover:bg-accent pointer-coarse:min-h-10",
                focusRing,
              )}
            >
              <FilterX aria-hidden="true" className="size-3.5" />
              همه روزها
            </Link>
          )}
        </nav>
      )}
    </section>
  );
}

/** One category's marker in a cell: its icon and (from `sm`) its count. */
function CellMarker({
  state,
  count,
}: {
  state: "RULE_VIOLATION" | "COVERAGE" | "UNDECIDED";
  count: number;
}) {
  if (count === 0) return null;
  return (
    <span
      data-marker={state}
      className={cn(
        "inline-flex shrink-0 items-center gap-0.5 rounded-full px-1 text-xs leading-5 font-semibold",
        state === "RULE_VIOLATION" && "bg-destructive/12 text-destructive",
        state === "COVERAGE" &&
          "bg-health-attention/20 text-health-attention-foreground",
        state === "UNDECIDED" &&
          "bg-health-unplanned/15 text-health-unplanned-foreground",
      )}
    >
      <DayStateIcon state={state} className="size-3.5 text-current" />
      <span className="tabular-nums max-sm:hidden">{faNumber(count)}</span>
    </span>
  );
}

/**
 * The top line of a cell: day number, holiday tag, and every category that
 * is open on the day at once (D103). A day without decisions shows only its
 * NOT STARTED mark; a ready day a small check.
 */
function CellTop({
  cell,
  today,
  selected,
}: {
  cell: { date: IsoDate; dayNumber: string; data: ReviewDay };
  today: IsoDate;
  selected: boolean;
}) {
  const day = cell.data;
  return (
    <span aria-hidden="true" className="flex items-start justify-between gap-1">
      <span className="flex min-w-0 items-center gap-1">
        <span
          className={cn(
            "inline-flex size-6 shrink-0 items-center justify-center rounded-full text-sm leading-none font-semibold tabular-nums",
            day.state === "NOT_STARTED" && "text-muted-foreground",
            day.holiday && "text-holiday-foreground",
            selected && "text-primary",
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
      {day.state === "READY" || day.state === "NOT_STARTED" ? (
        <DayStateIcon
          state={day.state}
          className={cn(
            "mt-1 size-3.5",
            day.state === "READY"
              ? "text-health-valid/80"
              : "text-health-unplanned",
          )}
        />
      ) : (
        <span className="flex flex-wrap justify-end gap-0.5">
          <CellMarker state="RULE_VIOLATION" count={day.ruleViolations} />
          <CellMarker
            state="COVERAGE"
            count={day.shortages + day.overstaffing}
          />
          <CellMarker state="UNDECIDED" count={day.undecided} />
        </span>
      )}
    </span>
  );
}

/**
 * Coverage per bucket (M, E, N; ME counts toward M and E, OFF toward none)
 * against the pinned rules: a shortage is marked ↓, overstaffing ↑ (icon and
 * number, never color alone). From `md` up.
 */
function CellCoverage({ day }: { day: ReviewDay }) {
  if (day.state === "NOT_STARTED")
    return (
      <span
        aria-hidden="true"
        className="mt-auto text-[0.6875rem] text-muted-foreground max-md:hidden"
      >
        {DAY_STATE_PRESENTATION.NOT_STARTED.label}
      </span>
    );
  return (
    <span
      aria-hidden="true"
      className="mt-auto grid max-w-36 grid-cols-3 gap-0.5 text-center max-md:hidden"
    >
      {day.buckets.map((b) => (
        <span
          key={b.period}
          data-bucket={b.period}
          data-staffing={b.status}
          className="flex min-w-0 flex-col leading-tight"
        >
          <span
            dir="ltr"
            className={cn(
              "text-[0.625rem] font-bold",
              SHIFT_PRESENTATION[b.period].accentClass,
            )}
          >
            {b.period}
          </span>
          <span
            className={cn(
              "inline-flex items-center justify-center gap-px text-sm font-semibold tabular-nums",
              b.status === "BELOW_MINIMUM" &&
                "text-health-attention-foreground",
              b.status === "ABOVE_MAXIMUM" && "text-status-warning-foreground",
            )}
          >
            {b.status === "BELOW_MINIMUM" && <ArrowDown className="size-3" />}
            {b.status === "ABOVE_MAXIMUM" && <ArrowUp className="size-3" />}
            {faNumber(b.covered)}
          </span>
        </span>
      ))}
    </span>
  );
}

/**
 * Hover: a quiet blue tint and hairline outline for ordinary days (the open
 * day keeps its own outline); a day with a problem deepens its own tint.
 */
const HOVER: Record<DayState, string> = {
  NOT_STARTED: "hover:bg-accent/80 hover:ring-1 hover:ring-primary/25",
  UNDECIDED: "hover:bg-accent/80 hover:ring-1 hover:ring-primary/25",
  READY: "hover:bg-accent/80 hover:ring-1 hover:ring-primary/25",
  COVERAGE: "hover:bg-health-attention/18",
  RULE_VIOLATION: "hover:bg-destructive/10",
};

const loud = (state: DayState) =>
  state === "COVERAGE" || state === "RULE_VIOLATION";

/**
 * Layer 1 of the Head Nurse review: the whole month as a Saturday-first
 * calendar on a hairline grid. Each in-period day links to its detail
 * (`?day=`); days that only complete the first or last week are muted and
 * inert. A cell carries only aggregates (category counts, coverage against
 * the pinned rules, holiday), never nurse data. Quiet by default, loud on
 * exceptions: a READY day adds nothing but a small check, a coverage problem
 * is amber, a rule violation red, an undecided or not-started day a cool gray
 * wash; the open day is outlined in the brand blue (D53, D56, D103).
 */
export function MonthCalendar({
  month,
  today,
  dayHref,
  selected,
  filter = null,
  shiftLabels,
}: {
  month: ScheduleMonthReview;
  today: IsoDate;
  dayHref: (date: IsoDate) => Route;
  /** The day open in the day detail, if any. */
  selected?: IsoDate | null;
  /** Days this filter does not match are dimmed (never hidden). */
  filter?: DayFilter | null;
  /** Descriptive shift names (`shift_types.label`), loaded once by the page. */
  shiftLabels: ShiftLabels;
}) {
  const grid = monthGrid(month.period, month.days);
  const unattributed = month.validation.unattributedRuleViolations;
  const hasHoliday = month.days.some((d) => d.holiday);
  return (
    <section aria-label="تقویم ماه" className="flex flex-col gap-2">
      {unattributed > 0 && (
        <p
          role="note"
          className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm"
        >
          <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {faNumber(unattributed)} {CATEGORY_LABELS.ruleViolation} مربوط به
          شیفت‌هایی خارج از روزهای این برنامه است.
        </p>
      )}

      <div className="overflow-hidden rounded-xl border bg-card shadow-sm shadow-primary/5">
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
                  className="border-b border-primary/10 bg-brand-soft/80 py-2 text-xs font-semibold text-brand-soft-foreground"
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
                {week.map((cell) => {
                  const dimmed =
                    !!filter &&
                    !!cell.data &&
                    !matchesDayFilter(filter, cell.data);
                  return (
                    <td
                      key={cell.date}
                      className={cn(
                        "h-14 border-e border-b p-0 align-top last:border-e-0 sm:h-16 md:h-[5.5rem] xl:h-24",
                        !cell.data && "bg-inert-hatch",
                      )}
                    >
                      {cell.data ? (
                        <Link
                          id={`day-${cell.date}`}
                          href={dayHref(cell.date)}
                          scroll={false}
                          prefetch={false}
                          aria-label={
                            dayCellLabel(cell.data) +
                            (dimmed ? "، خارج از فیلتر" : "")
                          }
                          aria-current={
                            cell.date === today ? "date" : undefined
                          }
                          data-state={cell.data.state}
                          data-filtered={
                            filter ? (dimmed ? "out" : "in") : undefined
                          }
                          data-selected={cell.date === selected || undefined}
                          className={cn(
                            "relative flex h-full min-w-0 flex-col gap-1 p-1 transition-colors ring-inset focus-visible:ring-inset motion-reduce:transition-none sm:p-1.5",
                            focusRing,
                            DAY_STATE_PRESENTATION[cell.data.state].cellClass,
                            dimmed && "opacity-35",
                            cell.date === selected
                              ? cn(
                                  "ring-2 ring-primary",
                                  loud(cell.data.state)
                                    ? HOVER[cell.data.state]
                                    : "bg-brand-soft hover:bg-brand-soft",
                                )
                              : HOVER[cell.data.state],
                          )}
                        >
                          <CellTop
                            cell={{ ...cell, data: cell.data }}
                            today={today}
                            selected={cell.date === selected}
                          />
                          <CellCoverage day={cell.data} />
                          <LinkPending />
                        </Link>
                      ) : (
                        <span
                          aria-hidden="true"
                          className="flex h-full p-1 text-sm text-muted-foreground/55 tabular-nums sm:p-1.5"
                        >
                          <span className="inline-flex size-6 items-center justify-center">
                            {cell.dayNumber}
                          </span>
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <CalendarLegend hasHoliday={hasHoliday} shiftLabels={shiftLabels} />
    </section>
  );
}

/**
 * One compact legend: what the numbers are, the day states and the
 * shortage / overstaffing marks. The holiday entry only when the month has
 * one (no holiday source is connected yet, D41).
 */
function CalendarLegend({
  hasHoliday,
  shiftLabels: l,
}: {
  hasHoliday: boolean;
  shiftLabels: ShiftLabels;
}) {
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
            {`تعداد نفرات در پوشش ${l.M}، ${l.E} و ${l.N} (شیفت ${l.ME} در ${l.M} و ${l.E} شمرده می‌شود؛ ${l.OFF} در پوشش شمرده نمی‌شود)`}
          </span>
        </span>
        <span className="inline-flex items-center gap-1 max-md:hidden">
          <ArrowDown aria-hidden="true" className="size-3.5" />
          {CATEGORY_LABELS.shortage}
        </span>
        <span className="inline-flex items-center gap-1 max-md:hidden">
          <ArrowUp aria-hidden="true" className="size-3.5" />
          {CATEGORY_LABELS.overstaffing}
        </span>
        {LEGEND_STATES.map((state) => (
          <span key={state} className="inline-flex items-center gap-1">
            <DayStateIcon state={state} className="size-3.5" />
            {DAY_STATE_PRESENTATION[state].label}
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
      <p>{DAY_STATE_PRESENTATION.READY.description}</p>
    </div>
  );
}

const LEGEND_STATES: readonly DayState[] = [
  "RULE_VIOLATION",
  "COVERAGE",
  "UNDECIDED",
  "READY",
  "NOT_STARTED",
];
