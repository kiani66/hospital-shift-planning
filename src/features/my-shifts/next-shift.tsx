"use client";

import { Clock3 } from "lucide-react";
import { useEffect, useState } from "react";

import type { NurseDashboard } from "@/application/my-shifts/dashboard";
import { Badge } from "@/components/ui/badge";
import { countdownMinutes, currentOrNextShift } from "@/domain/shifts/interval";
import { faNumber, formatJalaliDate } from "@/features/calendar/jalali";
import { shiftHoursLabel, type ShiftLabels } from "@/features/shifts/catalog";
import { ShiftChip } from "@/features/shifts/shift-chip";

import { PUBLICATION_PRESENTATION } from "./presentation";

export function NextShift({
  shifts,
  initialNow,
  shiftLabels,
}: {
  shifts: NurseDashboard["upcoming"];
  initialNow: number;
  shiftLabels: ShiftLabels;
}) {
  const [now, setNow] = useState(initialNow);
  useEffect(() => {
    const update = () => setNow(Date.now());
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, []);
  const current = currentOrNextShift(shifts, now);
  const shift = current?.shift;
  const publication = shift
    ? PUBLICATION_PRESENTATION[shift.entry.publication]
    : null;
  const minutes = shift ? countdownMinutes(shift.start, now) : 0;
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const rest = minutes % 60;
  const countdown = [
    days ? `${faNumber(days)} روز` : "",
    hours ? `${faNumber(hours)} ساعت` : "",
    rest ? `${faNumber(rest)} دقیقه` : "",
  ]
    .filter(Boolean)
    .join(" و ");

  return (
    <section
      aria-labelledby="next-shift-title"
      data-testid="next-shift"
      className="flex flex-col gap-3 rounded-xl border border-primary/20 bg-card p-4 shadow-sm shadow-primary/5 sm:p-5"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Clock3 aria-hidden="true" className="size-5 text-primary" />
        <h2 id="next-shift-title" className="font-semibold">
          {current?.active ? "شیفت در حال انجام" : "شیفت بعدی شما"}
        </h2>
        {current?.active && <Badge tone="brand-soft">در حال انجام</Badge>}
      </div>
      {shift && publication ? (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <ShiftChip
              code={shift.entry.shift}
              label={shiftLabels[shift.entry.shift]}
              size="md"
            />
            <p className="text-lg font-bold">
              {formatJalaliDate(shift.date, { weekday: true })}
            </p>
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
            <p>{shiftHoursLabel(shift.entry.shift, shiftLabels)}</p>
            <p className="text-muted-foreground">{shift.departmentName}</p>
          </div>
          {/* Minute changes are visual only; avoid recurring screen-reader announcements. */}
          <p className="font-medium text-primary">
            {current?.active
              ? "اکنون در این شیفت هستید."
              : `${countdown} تا شروع شیفت`}
          </p>
          <p className="text-sm text-muted-foreground">
            {publication.headline}
          </p>
          {shift.entry.changePending && (
            <p className="text-sm text-muted-foreground">
              تغییر در دست بررسی؛ تا تأیید، همین شیفت رسمی است.
            </p>
          )}
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          فعلاً شیفت پیش رویی برای شما ثبت نشده است. با آماده شدن برنامه، شیفت
          بعدی اینجا نمایش داده می‌شود.
        </p>
      )}
    </section>
  );
}
