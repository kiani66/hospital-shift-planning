import type { Route } from "next";
import Link from "next/link";

import type { MyShiftDay } from "@/application/my-shifts/queries";
import type { DatePeriod } from "@/domain/shared/period";
import type { IsoDate } from "@/domain/shared/dates";
import { monthGrid } from "@/features/calendar/month-grid";
import { LinkPending } from "@/features/schedule-review/link-pending";
import { SHIFT_PRESENTATION } from "@/features/shifts/catalog";
import { ShiftChip } from "@/features/shifts/shift-chip";
import { cn } from "@/lib/utils";

import {
  CHANGE_PENDING,
  PUBLICATION_PRESENTATION,
  dayCellLabel,
} from "./presentation";

const focusRing =
  "focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-none";

/** A shift that is not the approved schedule yet: a dashed outline, never color alone. */
export const UNAPPROVED_CHIP =
  "outline-1 outline-offset-1 outline-current outline-dashed";

/**
 * The nurse's month as a Saturday-first calendar (D4, D39's grid). Each day
 * of the month links to its detail (`?day=`, server-rendered, deep-linkable);
 * days that only complete the first or last week are hatched and inert. A
 * cell shows the day number and the actor's own shift code(s) in the
 * shift colors (the code text always rendered); the Persian name from `lg`
 * up. Shifts not approved yet have a dashed outline; a day with a pending
 * revision change carries the revision icon. Everything a cell shows by
 * color or shape is also in its accessible name.
 */
export function ShiftCalendar({
  period,
  days,
  today,
  selected,
  label,
  dayHref,
}: {
  period: DatePeriod;
  days: readonly MyShiftDay[];
  today: IsoDate;
  selected: IsoDate | null;
  label: string;
  dayHref: (date: IsoDate) => Route;
}) {
  const grid = monthGrid(period, days);
  const PendingIcon = CHANGE_PENDING.icon;
  return (
    <div className="overflow-hidden rounded-xl border bg-card shadow-sm shadow-primary/5">
      <table className="w-full table-fixed border-separate border-spacing-0">
        <caption className="sr-only">
          تقویم شیفت‌های شما در {label}؛ برای جزئیات هر روز، آن را انتخاب کنید.
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
                const day = cell.data;
                const isSelected = cell.date === selected;
                const pending =
                  day &&
                  (day.changePending ||
                    day.entries.some((e) => e.changePending));
                return (
                  <td
                    key={cell.date}
                    className={cn(
                      "h-16 border-e border-b p-0 align-top last:border-e-0 md:h-20",
                      !day && "bg-inert-hatch",
                    )}
                  >
                    {day ? (
                      <Link
                        id={`day-${cell.date}`}
                        href={dayHref(cell.date)}
                        scroll={false}
                        prefetch={false}
                        aria-label={dayCellLabel(day, { selected: isSelected })}
                        aria-current={cell.date === today ? "date" : undefined}
                        data-selected={isSelected || undefined}
                        data-shifts={day.entries.map((e) => e.shift).join(" ")}
                        className={cn(
                          "relative flex h-full min-w-0 flex-col gap-1 p-1 transition-colors ring-inset focus-visible:ring-inset motion-reduce:transition-none sm:p-1.5",
                          focusRing,
                          isSelected
                            ? "bg-brand-soft ring-2 ring-primary"
                            : "hover:bg-accent/80 hover:ring-1 hover:ring-primary/25",
                        )}
                      >
                        <span
                          aria-hidden="true"
                          className="flex items-start justify-between gap-1"
                        >
                          <span
                            className={cn(
                              "inline-flex size-6 shrink-0 items-center justify-center rounded-full text-sm leading-none font-semibold tabular-nums",
                              day.entries.length === 0 &&
                                "text-muted-foreground",
                              isSelected && "text-primary",
                              cell.date === today &&
                                "bg-primary text-primary-foreground",
                            )}
                          >
                            {cell.dayNumber}
                          </span>
                          {pending && (
                            <PendingIcon className="mt-1 size-3.5 shrink-0 text-health-attention-foreground" />
                          )}
                        </span>
                        <span
                          aria-hidden="true"
                          className="flex min-w-0 flex-wrap items-center gap-1"
                        >
                          {day.entries.map((e) => (
                            <span
                              key={e.scheduleId}
                              className="inline-flex min-w-0 items-center gap-1"
                            >
                              <ShiftChip
                                code={e.shift}
                                size="xs"
                                className={cn(
                                  "sm:min-w-7 sm:px-1.5 sm:text-xs sm:leading-5",
                                  PUBLICATION_PRESENTATION[e.publication]
                                    .unapproved && UNAPPROVED_CHIP,
                                )}
                              />
                              <span
                                className={cn(
                                  "truncate text-xs font-medium max-lg:hidden",
                                  SHIFT_PRESENTATION[e.shift].accentClass,
                                )}
                              >
                                {SHIFT_PRESENTATION[e.shift].name}
                              </span>
                            </span>
                          ))}
                        </span>
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
  );
}
