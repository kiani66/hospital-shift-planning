import {
  CalendarDays,
  CalendarOff,
  CalendarX2,
  ClipboardList,
  ListChecks,
  MessageSquarePlus,
  UserRoundX,
} from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import type {
  MyShiftDay,
  MyShiftEntry,
  MyShiftSchedule,
  MyShiftsMonth,
} from "@/application/my-shifts/queries";
import { Badge } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { EmptyState } from "@/components/ui/empty-state";
import { MetadataList } from "@/components/ui/metadata";
import { SectionHeader } from "@/components/ui/section-header";
import type { ShiftPublication } from "@/domain/schedule/publication";
import { SHIFT_CODES } from "@/domain/shifts/shift-type";
import type { IsoDate } from "@/domain/shared/dates";
import { isInPeriod } from "@/domain/shared/period";
import {
  faDigits,
  faNumber,
  formatJalaliDate,
  formatJalaliRange,
  jalaliWeekday,
  toJalali,
} from "@/features/calendar/jalali";
import {
  MonthNavLink,
  type MonthLink,
} from "@/features/schedule-review/month-calendar";
import { ShiftLegend } from "@/features/shell/shift-legend";
import {
  shiftFullName,
  shiftHoursLabel,
  type ShiftLabels,
} from "@/features/shifts/catalog";
import { ShiftChip } from "@/features/shifts/shift-chip";
import { cn } from "@/lib/utils";

import {
  CHANGE_PENDING,
  PUBLICATION_PRESENTATION,
  formatHours,
  shiftDurationLabel,
} from "./presentation";
import { ShiftCalendar, UNAPPROVED_CHIP } from "./shift-calendar";

export const MY_SHIFTS_MONTH_HEADING_ID = "my-shifts-month";

const focusRing =
  "focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-none";

/** The order notices appear in: what may still change first. */
const NOTICE_ORDER: readonly ShiftPublication[] = [
  "TEMPORARY",
  "RETURNED",
  "FINALIZED",
  "AWAITING_APPROVAL",
  "OFFICIAL",
];

function PublicationBadge({
  publication,
  size = "md",
}: {
  publication: ShiftPublication;
  size?: "sm" | "md";
}) {
  const p = PUBLICATION_PRESENTATION[publication];
  return (
    <Badge tone={p.tone} icon={p.icon} size={size}>
      {p.label}
    </Badge>
  );
}

/**
 * Previous / next calendar month around the month's name (D39: navigation is
 * by calendar month, whether or not a schedule exists), and a way back to
 * the current month from anywhere else.
 */
function MonthHeader({
  label,
  previous,
  next,
  currentMonthHref,
  schedules,
}: {
  label: string;
  previous: MonthLink | null;
  next: MonthLink | null;
  currentMonthHref: Route | null;
  schedules: readonly MyShiftSchedule[];
}) {
  return (
    <section
      aria-labelledby={MY_SHIFTS_MONTH_HEADING_ID}
      className="overflow-hidden rounded-xl border border-primary/15 bg-card shadow-sm shadow-primary/5"
    >
      <div className="flex items-center gap-2 p-3 sm:gap-3 sm:p-4">
        <MonthNavLink direction="previous" target={previous} />
        <h2
          id={MY_SHIFTS_MONTH_HEADING_ID}
          className="min-w-0 flex-1 text-center text-xl leading-snug font-bold sm:text-2xl"
        >
          {label}
        </h2>
        <MonthNavLink direction="next" target={next} />
      </div>
      {(schedules.length > 0 || currentMonthHref) && (
        <div className="flex flex-col gap-2 border-t border-primary/10 bg-brand-soft/50 px-3 py-2.5 text-sm sm:px-4">
          {schedules.length > 0 && (
            <ul aria-label="برنامه‌های این ماه" className="flex flex-col gap-2">
              {schedules.map((s) => (
                <li
                  key={s.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1.5"
                >
                  <span className="font-medium">{s.departmentName}</span>
                  <span className="text-muted-foreground tabular-nums">
                    {formatJalaliRange(s.period.start, s.period.end)}
                  </span>
                  <span className="sr-only">وضعیت:</span>
                  <PublicationBadge publication={s.publication} />
                </li>
              ))}
            </ul>
          )}
          {currentMonthHref && (
            <Link
              href={currentMonthHref}
              className={cn(
                "inline-flex min-h-11 items-center gap-1.5 self-start rounded-md font-medium text-primary underline-offset-4 hover:underline md:min-h-9",
                focusRing,
              )}
            >
              <CalendarDays aria-hidden="true" className="size-4" />
              رفتن به ماه جاری
            </Link>
          )}
        </div>
      )}
    </section>
  );
}

/**
 * One notice per state the month's schedules are in, the changeable ones
 * first and loudest: what the state means for the nurse in a sentence,
 * with its icon (never color alone). A revision in progress adds its days.
 */
function PublicationNotices({
  schedules,
}: {
  schedules: readonly MyShiftSchedule[];
}) {
  const states = NOTICE_ORDER.filter((state) =>
    schedules.some((s) => s.publication === state),
  );
  const pendingDays = [
    ...new Set(schedules.flatMap((s) => s.pendingChangeDates)),
  ].sort();
  const many = schedules.length > 1;
  return (
    <div className="flex flex-col gap-2">
      {states.map((state) => {
        const p = PUBLICATION_PRESENTATION[state];
        // Every reading that may still change is prominent; OFFICIAL is calm.
        const loud = p.unapproved;
        const names = schedules
          .filter((s) => s.publication === state)
          .map((s) => s.departmentName)
          .join("، ");
        return (
          <Callout
            key={state}
            as="div"
            role="note"
            tone={p.calloutTone}
            icon={p.icon}
            data-publication={state}
            className={cn(loud && "border-2 py-3")}
          >
            <p className={cn("font-semibold", loud && "text-base")}>
              {p.headline}
              {many && <span className="font-normal"> ({names})</span>}
            </p>
            <p className="text-muted-foreground">
              {p.description}
              {state === "TEMPORARY" && (
                <>
                  {" "}
                  اگر ثبت ترجیحات باز باشد، از{" "}
                  <Link
                    href="/preferences"
                    className={cn(
                      "font-medium text-primary underline underline-offset-4",
                      focusRing,
                    )}
                  >
                    صفحه ترجیحات
                  </Link>{" "}
                  می‌توانید ترجیح خود را ثبت کنید.
                </>
              )}
            </p>
          </Callout>
        );
      })}
      {pendingDays.length > 0 && (
        <Callout
          as="div"
          role="note"
          tone="attention"
          icon={CHANGE_PENDING.icon}
          data-publication="CHANGE_PENDING"
        >
          <p className="font-semibold">
            {CHANGE_PENDING.label}: {faNumber(pendingDays.length)} روز
          </p>
          <p className="text-muted-foreground">
            برای{" "}
            {pendingDays
              .map((d) => `${jalaliWeekday(d)} ${faDigits(toJalali(d).day)}`)
              .join("، ")}{" "}
            بازنگری‌ای در جریان است. تا تأیید آن، شیفت رسمی همان است که در تقویم
            می‌بینید.
          </p>
        </Callout>
      )}
    </div>
  );
}

/** The month's figures: shifts, scheduled hours, nights, and each shift type's count. */
function MonthTotals({
  totals,
  shiftLabels,
}: {
  totals: MyShiftsMonth["totals"];
  shiftLabels: ShiftLabels;
}) {
  const tiles = [
    ["شیفت‌ها", `${faNumber(totals.shiftCount)}`],
    ["ساعات برنامه‌ریزی‌شده", formatHours(totals.minutes)],
    [`شیفت ${shiftLabels.N}`, `${faNumber(totals.nightCount)}`],
    [`روزهای ${shiftLabels.OFF}`, `${faNumber(totals.offCount)}`],
  ] as const;
  return (
    <section aria-labelledby="month-totals" className="flex flex-col gap-2">
      <h2 id="month-totals" className="sr-only">
        جمع ماه
      </h2>
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {tiles.map(([term, value]) => (
          <div
            key={term}
            className="flex min-w-0 flex-col gap-1 rounded-xl border bg-card px-3 py-2.5 shadow-xs"
          >
            <dt className="text-xs leading-snug text-muted-foreground">
              {term}
            </dt>
            <dd className="text-lg leading-tight font-bold tabular-nums sm:text-xl">
              {value}
            </dd>
          </div>
        ))}
      </dl>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <ul
          aria-label="تعداد هر نوع شیفت"
          className="flex flex-wrap items-center gap-x-3 gap-y-1.5"
        >
          {SHIFT_CODES.map((code) => (
            <li key={code} className="inline-flex items-center gap-1.5">
              <ShiftChip code={code} size="xs" variant="soft" />
              <span className="sr-only">{shiftLabels[code]}:</span>
              <span className="tabular-nums">
                {faNumber(totals.byCode[code])}
              </span>
            </li>
          ))}
        </ul>
        {totals.includesUnapproved &&
          totals.shiftCount + totals.offCount > 0 && (
            <p className="text-xs text-muted-foreground">
              شامل شیفت‌های تأییدنشده؛ با تغییر برنامه، این ارقام هم تغییر
              می‌کند.
            </p>
          )}
      </div>
    </section>
  );
}

function EntryDetail({
  entry,
  schedule,
  showSchedule,
  shiftLabels,
}: {
  entry: MyShiftEntry;
  schedule: MyShiftSchedule | undefined;
  showSchedule: boolean;
  shiftLabels: ShiftLabels;
}) {
  return (
    <div
      data-entry={entry.shift}
      className="flex flex-col gap-3 rounded-lg border bg-background p-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <ShiftChip
          code={entry.shift}
          size="md"
          label={shiftFullName(entry.shift, shiftLabels)}
          className={cn(
            "px-3",
            PUBLICATION_PRESENTATION[entry.publication].unapproved &&
              UNAPPROVED_CHIP,
          )}
        />
        <PublicationBadge publication={entry.publication} size="sm" />
      </div>
      <MetadataList
        items={[
          ["ساعت", shiftHoursLabel(entry.shift, shiftLabels)],
          ["مدت", shiftDurationLabel(entry.shift)],
          ...(showSchedule && schedule
            ? ([["بخش", schedule.departmentName]] as const)
            : []),
        ]}
      />
      {entry.changePending && (
        <Callout tone="attention" icon={CHANGE_PENDING.icon}>
          <strong className="font-semibold">{CHANGE_PENDING.label}: </strong>
          {CHANGE_PENDING.description}
        </Callout>
      )}
      {entry.requestable && (
        <Link
          href="/requests"
          className={buttonClasses("outline", "self-start")}
        >
          <MessageSquarePlus aria-hidden="true" className="size-4" />
          درخواست تغییر این شیفت
        </Link>
      )}
    </div>
  );
}

/** Why a day shows no shift: no schedule covers it, or none is assigned that day. */
function noShiftText(date: IsoDate, schedules: readonly MyShiftSchedule[]) {
  return schedules.some((s) => isInPeriod(s.period, date))
    ? "تصمیم این روز هنوز تعیین نشده است."
    : "برای این روز برنامه‌ای برای شما وجود ندارد.";
}

/**
 * The selected day: its date, then each shift with its catalog hours and
 * duration, how settled it is, a pending revision change, and the way to ask
 * for a change (the requests page) while one may be made.
 */
function DayDetail({
  day,
  today,
  schedules,
  shiftLabels,
}: {
  day: MyShiftDay | null;
  today: IsoDate;
  schedules: readonly MyShiftSchedule[];
  shiftLabels: ShiftLabels;
}) {
  return (
    <section
      aria-labelledby="day-detail-title"
      className="flex flex-col gap-3 rounded-xl border bg-card p-3 shadow-xs sm:p-4"
    >
      {day ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="day-detail-title" className="text-base font-semibold">
              {formatJalaliDate(day.date, { weekday: true })}
            </h2>
            {day.date === today && (
              <Badge tone="brand-soft" size="sm">
                امروز
              </Badge>
            )}
          </div>
          {day.entries.length > 0 ? (
            day.entries.map((e) => (
              <EntryDetail
                key={e.scheduleId}
                entry={e}
                schedule={schedules.find((s) => s.id === e.scheduleId)}
                showSchedule={schedules.length > 1}
                shiftLabels={shiftLabels}
              />
            ))
          ) : (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <CalendarOff aria-hidden="true" className="size-4 shrink-0" />
              {noShiftText(day.date, schedules)}
            </p>
          )}
          {day.changePending && (
            <Callout tone="attention" icon={CHANGE_PENDING.icon}>
              <strong className="font-semibold">
                {CHANGE_PENDING.label}:{" "}
              </strong>
              {CHANGE_PENDING.description}
            </Callout>
          )}
        </>
      ) : (
        <>
          <h2 id="day-detail-title" className="text-base font-semibold">
            جزئیات روز
          </h2>
          <p className="text-sm text-muted-foreground">
            روزی را در تقویم انتخاب کنید تا ساعت و وضعیت شیفت آن را ببینید.
          </p>
        </>
      )}
    </section>
  );
}

/**
 * Every shift of the month in date order, one compact row each: the list
 * reading of the calendar (and the quickest scan on a phone).
 */
function ShiftAgenda({
  days,
  shiftLabels,
}: {
  days: readonly MyShiftDay[];
  shiftLabels: ShiftLabels;
}) {
  const rows = days.flatMap((d) => d.entries.map((e) => ({ date: d.date, e })));
  return (
    <section aria-labelledby="month-agenda" className="flex flex-col gap-3">
      <SectionHeader
        id="month-agenda"
        title="فهرست شیفت‌های ماه"
        icon={<ListChecks className="size-4" />}
        meta={`${faNumber(rows.length)} تصمیم ثبت‌شده`}
      />
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          در این ماه شیفتی برای شما ثبت نشده است.
        </p>
      ) : (
        <ol className="divide-y overflow-hidden rounded-xl border bg-card shadow-xs">
          {rows.map(({ date, e }) => {
            const p = PUBLICATION_PRESENTATION[e.publication];
            return (
              <li
                key={`${date}-${e.scheduleId}`}
                className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2"
              >
                <span className="w-24 shrink-0 text-sm font-medium tabular-nums">
                  {jalaliWeekday(date)} {faDigits(toJalali(date).day)}
                </span>
                <ShiftChip
                  code={e.shift}
                  label={shiftLabels[e.shift]}
                  className={cn(p.unapproved && UNAPPROVED_CHIP)}
                />
                <span className="text-sm text-muted-foreground tabular-nums">
                  {shiftHoursLabel(e.shift, shiftLabels)}
                </span>
                <span className="ms-auto flex flex-wrap items-center gap-1.5">
                  {e.changePending && (
                    <Badge
                      tone="attention"
                      size="sm"
                      icon={CHANGE_PENDING.icon}
                    >
                      {CHANGE_PENDING.label}
                    </Badge>
                  )}
                  {p.unapproved && (
                    <Badge tone={p.tone} size="sm" icon={p.icon}>
                      {p.label}
                    </Badge>
                  )}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

/**
 * `/my-shifts` for one calendar month: header with month navigation, the
 * state of the month's schedules (a prominent warning while shifts may
 * change), the month's totals, the calendar with the selected day's detail
 * beside it (below it on phones), the month's shift list and the legend.
 * Months without a schedule and nurses on no roster get their own empty
 * states. Schedules still being planned show the nurse's current working
 * assignments as temporary (D11 as amended, D98). The legend (codes, colors
 * and catalog hours) is shown in every state.
 */
export function MyShiftsView({
  month,
  label,
  previous,
  next,
  currentMonthHref,
  today,
  selected,
  dayHref,
  shiftLabels,
}: {
  month: MyShiftsMonth;
  label: string;
  previous: MonthLink | null;
  next: MonthLink | null;
  currentMonthHref: Route | null;
  today: IsoDate;
  selected: IsoDate | null;
  dayHref: (date: IsoDate) => Route;
  /** Descriptive shift names (`shift_types.label`), loaded once by the page. */
  shiftLabels: ShiftLabels;
}) {
  const selectedDay = selected
    ? (month.days.find((d) => d.date === selected) ?? null)
    : null;

  let body: ReactNode;
  if (!month.onAnyRoster)
    body = (
      <EmptyState
        icon={<UserRoundX />}
        title="هنوز در برنامه هیچ بخشی نیستید"
        description="وقتی سرپرستار شما را در برنامه ماهانه بخش قرار دهد، شیفت‌هایتان اینجا نمایش داده می‌شود."
      />
    );
  else if (month.schedules.length === 0)
    body = (
      <EmptyState
        icon={<CalendarX2 />}
        title="برای این ماه برنامه‌ای ندارید"
        description="در این ماه برنامه‌ای که شما در آن باشید ایجاد نشده است. با دکمه‌های ماه قبل و بعد، ماه‌های دیگر را ببینید."
      />
    );
  else
    body = (
      <>
        <PublicationNotices schedules={month.schedules} />
        <MonthTotals totals={month.totals} shiftLabels={shiftLabels} />
        {month.totals.shiftCount + month.totals.offCount === 0 && (
          <Callout role="note" tone="info" icon={ClipboardList}>
            در این ماه شیفتی برای شما ثبت نشده است.
          </Callout>
        )}
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <ShiftCalendar
            period={month.period}
            days={month.days}
            today={today}
            selected={selected}
            label={label}
            dayHref={dayHref}
            shiftLabels={shiftLabels}
          />
          <DayDetail
            day={selectedDay}
            today={today}
            schedules={month.schedules}
            shiftLabels={shiftLabels}
          />
        </div>
        <ShiftAgenda days={month.days} shiftLabels={shiftLabels} />
      </>
    );

  return (
    <div className="flex flex-col gap-4">
      <MonthHeader
        label={label}
        previous={previous}
        next={next}
        currentMonthHref={currentMonthHref}
        schedules={month.schedules}
      />
      {body}
      {/* Shift hours are useful in every state, even a month without a schedule. */}
      <section aria-labelledby="legend-title" className="flex flex-col gap-2">
        <h2 id="legend-title" className="text-sm font-semibold">
          راهنمای شیفت‌ها
        </h2>
        <ShiftLegend withHours shiftLabels={shiftLabels} />
        {month.schedules.length > 0 && (
          <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <ShiftChip code="M" size="xs" className={UNAPPROVED_CHIP} />
              خط‌چین: هنوز تأییدشده و رسمی نیست
            </span>
            <span className="inline-flex items-center gap-1.5">
              <CHANGE_PENDING.icon
                aria-hidden="true"
                className="size-3.5 text-health-attention-foreground"
              />
              {CHANGE_PENDING.label}
            </span>
          </p>
        )}
      </section>
    </div>
  );
}
