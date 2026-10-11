import { ArrowLeft, CalendarDays } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";

import type { AppContext } from "@/application/use-case";
import { getDepartmentSchedules } from "@/application/schedules/queries";
import { getScheduleReview } from "@/application/schedules/review";
import type { DepartmentSummary } from "@/application/workspace/queries";
import { buttonClasses } from "@/components/ui/button";
import { faNumber, formatJalaliRange } from "@/features/calendar/jalali";
import { validationBlockerLines } from "@/features/schedule-workflow/presentation";
import type { IsoDate } from "@/domain/shared/dates";

import { ScheduleStatusBadge } from "./status-badges";

/** Uses exactly the schedule page's current/upcoming/latest selection and authorized review. */
export async function HeadNurseOverview({
  ctx,
  departments,
  today,
}: {
  ctx: AppContext;
  departments: readonly DepartmentSummary[];
  today: IsoDate;
}) {
  const cards = await Promise.all(
    departments.map(async (department) => {
      const data = await getDepartmentSchedules(ctx, {
        departmentId: department.id,
        today,
      });
      const schedule = data.selected;
      const review = schedule
        ? await getScheduleReview(ctx, {
            departmentId: department.id,
            scheduleId: schedule.id,
          })
        : null;
      return { department, schedule, review };
    }),
  );
  if (!cards.length) return null;
  return (
    <section aria-labelledby="planning-overview" className="mb-6 space-y-3">
      <h2
        id="planning-overview"
        className="flex items-center gap-2 text-lg font-bold"
      >
        <CalendarDays aria-hidden="true" className="size-5 text-primary" />
        برنامه‌ریزی بخش‌های شما
      </h2>
      <p className="text-sm leading-relaxed text-muted-foreground">
        نخستین دوره جاری یا پیش‌رو نمایش داده می‌شود؛ اگر همه دوره‌ها گذشته
        باشند، آخرین برنامه را می‌بینید.
      </p>
      <div className="grid gap-4 xl:grid-cols-2">
        {cards.map(({ department, schedule, review }) => {
          const href =
            `/departments/${department.code}/schedule${schedule ? `?schedule=${schedule.id}` : ""}` as Route;
          return (
            <article
              key={department.id}
              aria-label={`برنامه‌ریزی ${department.name}`}
              className="flex min-w-0 flex-col gap-4 rounded-xl border bg-card p-4 shadow-xs"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <h3 className="min-w-0 font-semibold">{department.name}</h3>
                {schedule && <ScheduleStatusBadge status={schedule.status} />}
              </div>
              {schedule && review ? (
                <>
                  <p className="text-sm text-muted-foreground tabular-nums">
                    {formatJalaliRange(
                      schedule.period.start,
                      schedule.period.end,
                    )}
                    {schedule.period.end < today && " · دوره گذشته"}
                  </p>
                  <div className="space-y-2">
                    <p className="text-sm font-medium">
                      روزهای آماده نهایی‌سازی:{" "}
                      {faNumber(review.month.validation.readyDays)} از{" "}
                      {faNumber(review.month.validation.totalDays)} روز
                    </p>
                    <progress
                      aria-label="روزهای آماده نهایی‌سازی"
                      value={review.month.validation.readyDays}
                      max={review.month.validation.totalDays}
                      className="h-2 w-full appearance-none overflow-hidden rounded-full bg-muted [&::-moz-progress-bar]:bg-primary [&::-webkit-progress-bar]:bg-muted [&::-webkit-progress-value]:bg-primary"
                    />
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      آماده یعنی تصمیم همه پرسنل ثبت شده، پوشش نیرو در محدوده
                      قوانین است و قانون مسدودکننده‌ای نقض نشده است.
                    </p>
                  </div>
                  <ul
                    aria-label="وضعیت برنامه‌ریزی بخش"
                    className="space-y-1 text-sm"
                  >
                    {validationBlockerLines(review.month.validation).map(
                      (line) => (
                        <li key={line}>{line}</li>
                      ),
                    )}
                  </ul>
                  <p className="text-sm text-muted-foreground">
                    پرسنل ثبت‌شده در این برنامه:{" "}
                    {faNumber(schedule.roster.total)} نفر
                  </p>
                </>
              ) : (
                <p className="text-sm leading-relaxed text-muted-foreground">
                  هنوز برنامه‌ای برای این بخش ایجاد نشده است. برای شروع، یک
                  برنامه ماهانه ایجاد کنید.
                </p>
              )}
              <Link
                href={href}
                className={buttonClasses("default", "mt-auto self-start")}
              >
                {schedule
                  ? review?.month.editable
                    ? "ادامه برنامه‌ریزی"
                    : "مشاهده برنامه"
                  : "ایجاد برنامه ماهانه"}
                <ArrowLeft
                  aria-hidden="true"
                  className="size-4 ltr:-scale-x-100"
                />
              </Link>
            </article>
          );
        })}
      </div>
    </section>
  );
}
