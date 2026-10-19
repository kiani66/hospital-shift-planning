import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ConflictError, NotFoundError } from "@/application/errors";
import {
  getStaffingReport,
  type StaffingReport,
} from "@/application/staffing-report/queries";
import { getWorkforceReportSelection } from "@/application/workforce-report/selection";
import { Button, buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ValidationError } from "@/domain/shared/errors";
import { requireRequestContext } from "@/features/auth/guards";
import {
  adjacentJalaliMonth,
  formatJalaliRange,
  jalaliMonthLabel,
  jalaliMonthParam,
  jalaliMonthPeriod,
  parseJalaliMonthParam,
  toJalali,
} from "@/features/calendar/jalali";
import { requireDepartmentPage } from "@/features/shell/department-page";
import { PageHeader } from "@/features/shell/page-header";
import {
  staffingHref,
  staffingParams,
  showStaffingDraft,
  staffingMonthState,
} from "@/features/staffing-report/presentation";
import { ReportUnavailable, selectClasses } from "@/features/reporting/shared";
import { StaffingReportView } from "@/features/staffing-report/report-view";
import { APP_TIMEZONE, todayIn } from "@/infrastructure/auth/actor";

export const metadata: Metadata = { title: "گزارش پوشش و کمبود نیرو" };

export default async function StaffingPage({
  params,
  searchParams,
}: PageProps<"/departments/[code]/staffing">) {
  const department = await requireDepartmentPage(params, "department.manage");
  const ctx = await requireRequestContext();
  const parsed = staffingParams.safeParse(await searchParams);
  if (!parsed.success) notFound();
  const requested = parsed.data;
  const month =
    requested.month === undefined
      ? toJalali(todayIn(APP_TIMEZONE))
      : parseJalaliMonthParam(requested.month);
  if (!month) notFound();
  const monthParam = jalaliMonthParam(month);
  const selection = await getWorkforceReportSelection(ctx, {
    departmentId: department.id,
    period: jalaliMonthPeriod(month),
    scheduleId: requested.schedule,
  }).catch((error: unknown) => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  });
  const state = {
    ...requested,
    month: monthParam,
    schedule: selection.selectedId ?? undefined,
  };
  const here = (changes: Partial<typeof state>) =>
    staffingHref(department.code, { ...state, ...changes });
  let report: StaffingReport | null = null;
  let unavailable = false;
  if (selection.selectedId) {
    try {
      report = await getStaffingReport(ctx, {
        departmentId: department.id,
        scheduleId: selection.selectedId,
        source: state.source,
      });
    } catch (error) {
      if (error instanceof NotFoundError) notFound();
      if (error instanceof ConflictError || error instanceof ValidationError)
        unavailable = true;
      else throw error;
    }
  }
  const previous = adjacentJalaliMonth(month, "previous");
  const next = adjacentJalaliMonth(month, "next");

  return (
    <>
      <PageHeader
        title="گزارش پوشش و کمبود نیرو"
        description={`${department.name} · پوشش پرستاری ثبت‌شده برای یک برنامه بخش`}
      />
      <section
        aria-label="انتخاب ماه و برنامه"
        className="mb-5 space-y-4 rounded-xl border bg-card p-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-bold">{jalaliMonthLabel(month)}</h2>
          <nav aria-label="ماه گزارش" className="flex gap-2">
            {previous && (
              <Link
                className={buttonClasses("outline")}
                href={staffingHref(
                  department.code,
                  staffingMonthState(
                    state,
                    jalaliMonthParam(previous),
                    jalaliMonthPeriod(previous),
                    selection.schedules.find(
                      (s) => s.id === selection.selectedId,
                    ),
                  ),
                )}
              >
                <ChevronRight className="size-4" aria-hidden />
                ماه قبل
              </Link>
            )}
            {next && (
              <Link
                className={buttonClasses("outline")}
                href={staffingHref(
                  department.code,
                  staffingMonthState(
                    state,
                    jalaliMonthParam(next),
                    jalaliMonthPeriod(next),
                    selection.schedules.find(
                      (s) => s.id === selection.selectedId,
                    ),
                  ),
                )}
              >
                ماه بعد
                <ChevronLeft className="size-4" aria-hidden />
              </Link>
            )}
          </nav>
        </div>
        {selection.schedules.length > 1 && (
          <form
            method="get"
            className="flex flex-wrap items-end gap-3"
            aria-label="انتخاب برنامه گزارش"
          >
            <input type="hidden" name="month" value={monthParam} />
            <input type="hidden" name="source" value={state.source} />
            <input type="hidden" name="status" value={state.status} />
            <input type="hidden" name="bucket" value={state.bucket} />
            <label className="min-w-0 flex-1 basis-64 space-y-1 text-sm">
              برنامه مورد گزارش
              <select
                required
                name="schedule"
                className={selectClasses}
                defaultValue={selection.selectedId ?? ""}
              >
                <option value="" disabled>
                  یک برنامه را انتخاب کنید
                </option>
                {selection.schedules.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label} —{" "}
                    {formatJalaliRange(s.period.start, s.period.end)}
                  </option>
                ))}
              </select>
            </label>
            <Button type="submit">نمایش برنامه</Button>
            <p className="basis-full text-sm text-muted-foreground">
              بیش از یک برنامه با این ماه هم‌پوشانی دارد. هر گزارش فقط یک برنامه
              را پوشش می‌دهد؛ برنامه‌ها با هم جمع نمی‌شوند.
            </p>
          </form>
        )}
        {selection.selectedId && (
          <nav aria-label="انتخاب منبع گزارش" className="flex flex-wrap gap-2">
            <Link
              className={buttonClasses(
                state.source === "DEFAULT" ? "secondary" : "outline",
              )}
              aria-current={state.source === "DEFAULT" ? "page" : undefined}
              href={here({ source: "DEFAULT" })}
            >
              {report?.provenance.approvedVersion
                ? "نسخه رسمی تأییدشده"
                : report?.provenance.source === "WORKING_COPY"
                  ? "گزارش موقت برنامه"
                  : "گزارش پیش‌فرض"}
            </Link>
            {showStaffingDraft(report, selection.revisionDraftAvailable) && (
              <Link
                className={buttonClasses(
                  state.source === "REVISION_DRAFT" ? "secondary" : "outline",
                )}
                aria-current={
                  state.source === "REVISION_DRAFT" ? "page" : undefined
                }
                href={here({ source: "REVISION_DRAFT" })}
              >
                پیش‌نویس اصلاحات — تأییدنشده
              </Link>
            )}
          </nav>
        )}
      </section>
      {selection.schedules.length === 0 ? (
        <EmptyState
          icon={<CalendarDays />}
          title="برنامه‌ای برای این ماه وجود ندارد"
          description="ماه دیگری را انتخاب کنید. برنامه‌های ماه‌های دیگر به این گزارش اضافه نمی‌شوند."
        />
      ) : !selection.selectedId ? (
        <ReportUnavailable description="برای دیدن گزارش، یکی از برنامه‌های هم‌پوشان این ماه را انتخاب کنید." />
      ) : unavailable || !report ? (
        <ReportUnavailable
          description={
            state.source === "REVISION_DRAFT"
              ? "پیش‌نویس اصلاحات واجد شرایط در دسترس نیست. برای مشاهده منبع پیش‌فرض برنامه، گزینه زیر را انتخاب کنید."
              : "داده‌های این برنامه در حال حاضر قابل گزارش نیستند. دوباره صفحه را بارگذاری کنید یا با مسئول سامانه تماس بگیرید."
          }
          action={
            state.source === "REVISION_DRAFT" ? (
              <Link
                className={buttonClasses("outline")}
                href={here({ source: "DEFAULT" })}
              >
                مشاهده گزارش پیش‌فرض
              </Link>
            ) : undefined
          }
        />
      ) : (
        <StaffingReportView
          report={report}
          code={department.code}
          state={state}
        />
      )}
    </>
  );
}
