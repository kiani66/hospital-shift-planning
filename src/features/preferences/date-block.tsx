import type { MyPreferenceDay } from "@/application/preferences/queries";
import { cn } from "@/lib/utils";

import type { DayView } from "./presentation";

export const HOLIDAY_LABEL = "تعطیل";

/** The prominent date: weekday, day number, month; today and holidays marked. */
export function DateBlock({
  view,
  className,
}: {
  view: DayView<MyPreferenceDay>;
  className?: string;
}) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "flex w-12 shrink-0 flex-col items-center justify-center rounded-md py-1 text-center",
        view.isToday ? "bg-primary text-primary-foreground" : "bg-muted",
        className,
      )}
    >
      <span className="text-[0.6875rem] leading-tight">{view.weekday}</span>
      <span className="text-lg leading-tight font-bold">{view.dayNumber}</span>
      <span className="text-[0.6875rem] leading-tight">{view.monthName}</span>
      {view.day.holiday && (
        <span
          data-holiday
          title={view.day.holiday.name}
          className={cn(
            "mt-0.5 rounded px-1 text-[0.625rem] leading-4 font-medium",
            view.isToday
              ? "bg-primary-foreground/20"
              : "bg-holiday/10 text-holiday-foreground",
          )}
        >
          {HOLIDAY_LABEL}
        </span>
      )}
    </div>
  );
}
