"use client";

import { ChevronDown, Lock } from "lucide-react";
import { useCallback, useState } from "react";

import type { MyPreferenceDay } from "@/application/preferences/queries";
import type { IsoDate } from "@/domain/shared/dates";
import type { PreferenceValue } from "@/domain/shifts/shift-type";
import type { ShiftLabels } from "@/features/shifts/catalog";
import { faNumber } from "@/features/calendar/jalali";
import { cn } from "@/lib/utils";

import { DateBlock, HOLIDAY_LABEL } from "./date-block";
import { PreferenceDayEditor } from "./preference-day-editor";
import { PreferenceSummary } from "./preference-summary";
import {
  LOCK_REASONS,
  countPreferences,
  myPreferenceText,
  type DayGroup,
  type DayView,
} from "./presentation";
import type { PreferenceChoice } from "./save-queue";

const focusRing =
  "focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-none";

/**
 * The editable month: the summary, then the days in collapsible date-range
 * groups. Holds the stored value of every day (from the page, then from
 * each confirmed save) so the summary follows successful saves at once
 * without another request. Collapsed groups stay mounted (only hidden), so
 * a save in flight is never lost by collapsing its group.
 */
export function PreferenceMonthEditor({
  scheduleId,
  groups,
  initiallyOpen,
  shiftLabels,
}: {
  scheduleId: string;
  /** Every day of the schedule, grouped (Jalali labels are made on the server). */
  groups: readonly DayGroup<MyPreferenceDay>[];
  initiallyOpen: IsoDate | null;
  /** Descriptive shift names (`shift_types.label`). */
  shiftLabels: ShiftLabels;
}) {
  const [stored, setStored] = useState(() => storedOf(groups));
  const [source, setSource] = useState(groups);
  if (source !== groups) {
    // A refreshed page: the server's values are the stored ones.
    setSource(groups);
    setStored(storedOf(groups));
  }
  const confirm = useCallback(
    (date: IsoDate, value: PreferenceChoice) =>
      setStored((current) =>
        current[date] === value ? current : { ...current, [date]: value },
      ),
    [],
  );
  const [open, setOpen] = useState<ReadonlySet<IsoDate>>(
    () => new Set(initiallyOpen ? [initiallyOpen] : []),
  );
  const toggle = (key: IsoDate) =>
    setOpen((current) => {
      const next = new Set(current);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  const counts = countPreferences(Object.values(stored));
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_20rem] xl:items-start">
      <PreferenceSummary
        counts={counts}
        shiftLabels={shiftLabels}
        className="xl:sticky xl:top-20 xl:col-start-2 xl:row-start-1"
      />
      <div className="flex min-w-0 flex-col gap-2 xl:col-start-1 xl:row-start-1">
        {groups.map((group) => (
          <DayGroupSection
            key={group.key}
            group={group}
            open={open.has(group.key)}
            onToggle={() => toggle(group.key)}
            count={group.days.filter((v) => stored[v.day.date] != null).length}
          >
            {group.days.map((view) => (
              <DayCard
                key={view.day.date}
                scheduleId={scheduleId}
                view={view}
                onConfirmed={confirm}
                shiftLabels={shiftLabels}
              />
            ))}
          </DayGroupSection>
        ))}
      </div>
    </div>
  );
}

const storedOf = (groups: readonly DayGroup<MyPreferenceDay>[]) =>
  Object.fromEntries(
    groups.flatMap((g) => g.days.map((v) => [v.day.date, v.day.value])),
  ) as Record<IsoDate, PreferenceValue | null>;

function DayGroupSection({
  group,
  open,
  onToggle,
  count,
  children,
}: {
  group: DayGroup<MyPreferenceDay>;
  open: boolean;
  onToggle: () => void;
  count: number;
  children: React.ReactNode;
}) {
  const panelId = `days-${group.key}`;
  return (
    <section
      aria-labelledby={`${panelId}-heading`}
      className="rounded-lg border bg-card"
    >
      <h3 id={`${panelId}-heading`} className="text-sm">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={onToggle}
          className={cn(
            "flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-start font-semibold hover:bg-accent/60",
            focusRing,
          )}
        >
          <ChevronDown
            aria-hidden="true"
            className={cn(
              "size-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none",
              // Collapsed: points toward the reading direction (left in RTL).
              !open && "rotate-90",
            )}
          />
          <span className="min-w-0 flex-1 truncate">{group.label}</span>
          {group.containsToday && (
            <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
              امروز
            </span>
          )}
          <span className="shrink-0 text-xs font-normal text-muted-foreground tabular-nums">
            {count > 0 ? `${faNumber(count)} ترجیح` : null}
          </span>
        </button>
      </h3>
      <div id={panelId} hidden={!open} className="px-1.5 pb-1.5">
        {/* One day per row at every width: a day never shares its row. */}
        <ol className="flex flex-col gap-1.5">{children}</ol>
      </div>
    </section>
  );
}

function DayCard({
  scheduleId,
  view,
  onConfirmed,
  shiftLabels,
}: {
  scheduleId: string;
  view: DayView<MyPreferenceDay>;
  onConfirmed: (date: IsoDate, value: PreferenceChoice) => void;
  shiftLabels: ShiftLabels;
}) {
  const { day } = view;
  const confirm = useCallback(
    (value: PreferenceChoice) => onConfirmed(day.date, value),
    [onConfirmed, day.date],
  );
  const label = day.holiday
    ? `${view.fullLabel} (${HOLIDAY_LABEL}: ${day.holiday.name})`
    : view.fullLabel;
  return (
    <li
      aria-current={view.isToday ? "date" : undefined}
      aria-label={label}
      className={cn(
        "flex min-w-0 gap-2 rounded-md border bg-background p-2",
        view.isToday && "border-primary/60",
        day.lock !== null && "bg-muted/40",
      )}
    >
      <DateBlock view={view} />
      <div className="@container min-w-0 flex-1">
        {day.lock === null ? (
          <PreferenceDayEditor
            scheduleId={scheduleId}
            date={day.date}
            value={day.value}
            dayLabel={view.fullLabel}
            onConfirmed={confirm}
            shiftLabels={shiftLabels}
          />
        ) : (
          <div className="flex min-h-full flex-col justify-center gap-1 text-sm">
            <p
              className={cn(
                day.value === null ? "text-muted-foreground" : "font-semibold",
              )}
            >
              {myPreferenceText(day.value, shiftLabels)}
            </p>
            <p className="flex items-start gap-1.5 text-xs leading-relaxed text-muted-foreground">
              <Lock aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
              <span>
                <span className="sr-only">قابل ویرایش نیست: </span>
                {LOCK_REASONS[day.lock]}
              </span>
            </p>
          </div>
        )}
      </div>
    </li>
  );
}
