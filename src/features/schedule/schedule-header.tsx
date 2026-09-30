import { CalendarRange, Eye, Pencil } from "lucide-react";
import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { IconWell } from "@/components/ui/icon-well";
import type { PreferenceCollectionState } from "@/domain/preferences/preference-window";
import type { ScheduleStatus } from "@/domain/schedule/status";
import {
  MonthNavLink,
  type MonthLink,
} from "@/features/schedule-review/month-calendar";

import { PreferenceStateBadge, ScheduleStatusBadge } from "./status-badges";

export const SCHEDULE_HEADING_ID = "schedule-month-heading";

/**
 * The one header of the department schedule page. It answers, in order:
 * which department and month (both in the page's `h1`, the month as its
 * focal line, between the previous / next calendar-month links, D39), the schedule's lifecycle
 * status, whether preference collection is open, whether the Head Nurse is
 * editing or only reviewing, and the single next action. Creating another
 * month is a quiet secondary control. A month without a schedule keeps the
 * same header with no status. A light brand-tinted panel (not a hero): the
 * one place the page states its identity, so the calendar below stays calm.
 */
export function ScheduleHeader({
  departmentName,
  monthLabel,
  previous,
  next,
  schedule,
  primaryAction,
  secondaryAction,
}: {
  departmentName: string;
  monthLabel: string;
  previous: MonthLink | null;
  next: MonthLink | null;
  schedule: {
    readonly range: string;
    readonly status: ScheduleStatus;
    readonly preferences: PreferenceCollectionState;
    /** The Head Nurse may change assignments of this schedule now. */
    readonly editable: boolean;
  } | null;
  primaryAction?: ReactNode;
  secondaryAction?: ReactNode;
}) {
  return (
    <section
      aria-labelledby={SCHEDULE_HEADING_ID}
      className="mb-4 flex flex-col gap-3 rounded-xl border border-primary/15 bg-brand-soft/60 p-3 sm:p-4"
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          <IconWell
            size="md"
            className="bg-primary text-primary-foreground shadow-sm max-sm:hidden"
          >
            <CalendarRange />
          </IconWell>
          <MonthNavLink direction="previous" target={previous} />
          <h1
            id={SCHEDULE_HEADING_ID}
            className="flex min-w-0 flex-1 flex-col text-center sm:flex-none sm:text-start"
          >
            <span className="truncate text-sm font-medium text-brand-soft-foreground">
              برنامه بخش · {departmentName}
            </span>
            <span className="sr-only">، </span>
            <span className="text-xl leading-snug font-bold text-foreground sm:text-2xl">
              {monthLabel}
            </span>
          </h1>
          <MonthNavLink direction="next" target={next} />
        </div>
        {(primaryAction || secondaryAction) && (
          <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:flex-wrap sm:items-start lg:justify-end max-sm:[&>button:last-child]:self-center">
            {primaryAction}
            {secondaryAction}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm max-sm:justify-center">
        {schedule ? (
          <>
            <span className="text-muted-foreground tabular-nums">
              {schedule.range}
            </span>
            <span
              aria-hidden="true"
              className="h-4 w-px bg-primary/20 max-sm:hidden"
            />
            <span className="sr-only">وضعیت برنامه:</span>
            <ScheduleStatusBadge status={schedule.status} />
            <PreferenceStateBadge state={schedule.preferences} withPrefix />
            {schedule.editable ? (
              <Badge tone="brand-soft" icon={Pencil}>
                ویرایش شیفت‌ها
              </Badge>
            ) : (
              <Badge tone="muted" icon={Eye}>
                فقط مشاهده
              </Badge>
            )}
          </>
        ) : (
          <Badge tone="muted">بدون برنامه</Badge>
        )}
      </div>
    </section>
  );
}
