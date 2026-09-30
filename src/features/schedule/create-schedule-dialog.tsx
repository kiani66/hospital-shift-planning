"use client";

import { CalendarPlus } from "lucide-react";
import { useActionState, useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import type {
  JalaliMonth,
  JalaliMonthOption,
} from "@/features/calendar/jalali";
import { cn } from "@/lib/utils";

import { createScheduleAction, type ScheduleFormState } from "./actions";

const selectClasses =
  "min-h-11 w-full rounded-md border border-input bg-background px-3 text-base focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none";

/**
 * Create a monthly schedule by picking a Jalali year and month. The month list
 * and date previews come from the server (Tehran's "today"); the server action
 * converts the chosen month to ISO dates again, so nothing here is trusted.
 */
export function CreateScheduleDialog({
  department,
  years,
  options,
  suggested,
  primary = false,
}: {
  department: { id: string; code: string; name: string };
  years: readonly number[];
  options: readonly JalaliMonthOption[];
  suggested: JalaliMonth;
  primary?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(suggested.year);
  const [month, setMonth] = useState(suggested.month);
  const [state, action, pending] = useActionState<ScheduleFormState, FormData>(
    createScheduleAction,
    { status: "idle" },
  );
  const ids = { year: useId(), month: useId(), preview: useId() };

  const months = options.filter((o) => o.year === year);
  const chosen = months.find((o) => o.month === month);
  const faYear = (y: number) =>
    new Intl.NumberFormat("fa-IR", { useGrouping: false }).format(y);

  return (
    <>
      <Button
        // The secondary "another month" control stays quiet next to the
        // schedule's own next action (D52).
        variant={primary ? "default" : "ghost"}
        className={primary ? undefined : "text-muted-foreground"}
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
      >
        <CalendarPlus aria-hidden="true" className="size-5" />
        {primary ? "ایجاد برنامه ماهانه" : "برنامه ماهانه جدید"}
      </Button>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="ایجاد برنامه ماهانه"
        description={`برنامه برای ${department.name} ایجاد می‌شود و فهرست پرسنل آن از عضویت‌های همان ماه ثبت می‌شود.`}
      >
        <form action={action} className="flex flex-col gap-4">
          <input type="hidden" name="departmentId" value={department.id} />
          <input type="hidden" name="departmentCode" value={department.code} />

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor={ids.year}>سال</Label>
              <select
                id={ids.year}
                name="year"
                value={year}
                onChange={(e) => setYear(Number(e.target.value))}
                className={selectClasses}
              >
                {years.map((y) => (
                  <option key={y} value={y}>
                    {faYear(y)}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor={ids.month}>ماه</Label>
              <select
                id={ids.month}
                name="month"
                value={month}
                onChange={(e) => setMonth(Number(e.target.value))}
                aria-describedby={ids.preview}
                className={selectClasses}
              >
                {months.map((o) => (
                  <option key={o.month} value={o.month} disabled={o.taken}>
                    {o.taken ? `${o.label} (دارای برنامه)` : o.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div
            id={ids.preview}
            aria-live="polite"
            className={cn(
              "rounded-md border px-4 py-3 text-sm leading-relaxed",
              chosen?.taken
                ? "border-destructive/40 bg-destructive/5"
                : "bg-muted/40",
            )}
          >
            {chosen && (
              <>
                <p className="font-semibold">{chosen.label}</p>
                <dl className="mt-1 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5">
                  <dt className="text-muted-foreground">از</dt>
                  <dd>{chosen.startLabel}</dd>
                  <dt className="text-muted-foreground">تا</dt>
                  <dd>{chosen.endLabel}</dd>
                  <dt className="text-muted-foreground">مدت</dt>
                  <dd>
                    {new Intl.NumberFormat("fa-IR").format(chosen.dayCount)} روز
                  </dd>
                </dl>
                {chosen.taken && (
                  <p className="mt-2 font-medium text-destructive">
                    برای این ماه قبلاً برنامه ایجاد شده است.
                  </p>
                )}
              </>
            )}
          </div>

          <div
            role="alert"
            className={
              state.status === "error"
                ? "rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2.5 text-sm leading-relaxed text-destructive"
                : "sr-only"
            }
          >
            {state.status === "error" ? state.message : null}
          </div>

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={() => setOpen(false)}>
              انصراف
            </Button>
            <Button type="submit" disabled={pending || !chosen || chosen.taken}>
              {pending ? "در حال ایجاد…" : "ایجاد برنامه"}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
