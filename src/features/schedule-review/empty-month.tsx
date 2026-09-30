import { CalendarPlus } from "lucide-react";
import type { ReactNode } from "react";

import { MonthHeader, type MonthLink } from "./month-calendar";

/**
 * A calendar month that has no schedule. Navigation still works from here
 * (Previous / Next are calendar months, not schedule records); `action` is
 * the create-month control, given only when the Head Nurse may create.
 */
export function EmptyMonth({
  label,
  previous,
  next,
  action,
}: {
  label: string;
  previous: MonthLink | null;
  next: MonthLink | null;
  action: ReactNode | null;
}) {
  return (
    <section
      aria-labelledby="month-calendar-heading"
      className="flex flex-col gap-4 rounded-lg border bg-card p-3 sm:p-5"
    >
      <MonthHeader
        label={label}
        headingId="month-calendar-heading"
        previous={previous}
        next={next}
      />
      <div className="flex flex-col items-center gap-4 rounded-lg border border-dashed px-6 py-12 text-center">
        <CalendarPlus
          aria-hidden="true"
          className="size-10 text-muted-foreground"
        />
        <p className="text-lg font-semibold">
          برای این ماه هنوز برنامه‌ای ایجاد نشده است.
        </p>
        {action}
      </div>
    </section>
  );
}
