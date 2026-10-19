import { AlertTriangle, Info, Search } from "lucide-react";
import Link from "next/link";

import type { StaffingReport } from "@/application/staffing-report/queries";
import { Button, buttonClasses } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { EmptyState } from "@/components/ui/empty-state";
import type { StaffingBucketRecord } from "@/domain/staffing-report/summary";
import {
  faNumber,
  formatJalaliDate,
  formatJalaliRange,
} from "@/features/calendar/jalali";
import { ReportProvenance, selectClasses } from "@/features/reporting/shared";
import { ShiftChip } from "@/features/shifts/shift-chip";

import {
  BUCKET_LABELS,
  ORIGIN_LABELS,
  STATUS_LABELS,
  staffingDays,
  staffingGap,
  staffingHref,
  visibleStaffingRows,
  type StaffingParams,
} from "./presentation";

const statusClasses = {
  SHORTAGE:
    "border-health-attention/50 bg-health-attention/10 text-health-attention-foreground",
  EXCESS:
    "border-status-review/30 bg-status-review/8 text-status-review-foreground",
  WITHIN_BOUNDS: "border-border bg-muted/50 text-muted-foreground",
};

function StaffingStatus({ row }: { row: StaffingBucketRecord }) {
  return (
    <span
      className={`inline-flex rounded-md border px-2 py-1 text-xs font-semibold ${statusClasses[row.status]}`}
    >
      {STATUS_LABELS[row.status]}
    </span>
  );
}

const maximum = (row: StaffingBucketRecord) =>
  row.max === null ? "بدون حداکثر" : faNumber(row.max);

export function StaffingReportView({
  report,
  code,
  state,
}: {
  report: StaffingReport;
  code: string;
  state: StaffingParams;
}) {
  const rows = visibleStaffingRows(report.rows, state);
  const totals = report.totals;
  const cards = [
    ["نوبت‌های دارای کمبود", totals.shortageBuckets],
    ["روزهای دارای کمبود", totals.shortageDays],
    ["نوبت‌های دارای مازاد", totals.excessBuckets],
    ["جمع کمبود نفر-نوبت", totals.shortagePersonPeriods],
  ] as const;
  return (
    <div className="min-w-0 space-y-5">
      <section
        aria-label="برنامه و منبع گزارش"
        className="space-y-4 rounded-xl border bg-card p-4"
      >
        <div>
          <h2 className="font-bold">{report.schedule.label}</h2>
          <p className="mt-1 text-sm">
            بازه واقعی گزارش:{" "}
            {formatJalaliRange(report.period.start, report.period.end)} ·{" "}
            {faNumber(report.reportingDayCount)} روز
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            فقط همین برنامه و منبع انتخاب‌شده؛ برنامه‌ها با هم جمع نمی‌شوند.
          </p>
        </div>
        <section
          aria-label="منبع گزارش"
          data-report-source={report.provenance.source}
        >
          <ReportProvenance provenance={report.provenance} />
        </section>
        <p className="text-sm" data-rule-version={report.ruleSet.versionId}>
          قوانین پوشش: نسخه {faNumber(report.ruleSet.versionNo)} ·{" "}
          {report.ruleSet.scope === "HOSPITAL_DEFAULT"
            ? "پیش‌فرض بیمارستان"
            : "اختصاصی بخش"}
          {report.ruleSet.status === "RETIRED" &&
            " · بازنشسته (معتبر برای این برنامه)"}
        </p>
      </section>
      <dl
        aria-label="خلاصه کل بازه گزارش"
        className="grid grid-cols-2 gap-3 xl:grid-cols-4"
      >
        {cards.map(([label, value]) => (
          <div key={label} className="rounded-xl border bg-card p-4">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="mt-2 text-xl font-bold tabular-nums">
              {faNumber(value)}
            </dd>
          </div>
        ))}
      </dl>
      <p className="text-xs leading-relaxed text-muted-foreground">
        هر نوبت یک تاریخ × صبح، عصر یا شب است؛ روزها به‌صورت متمایز شمرده
        می‌شوند. نفر-نوبت، جمع فاصله از حد پوشش است؛ نه تعداد افراد یکتا، نیاز
        استخدام یا حضور واقعی. کمبود و مازاد از هم کسر نمی‌شوند.
      </p>
      <details className="rounded-xl border bg-card p-4">
        <summary className="min-h-7 cursor-pointer text-sm font-semibold focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-none">
          شمارش‌های تکمیلی کل بازه
        </summary>
        <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          {[
            ["جمع مازاد نفر-نوبت", totals.excessPersonPeriods],
            ["روزهای دارای مازاد", totals.excessDays],
            ["نوبت‌های در محدوده", totals.withinBoundsBuckets],
            ["روز-پرستار تعیین‌نشده", report.undecidedNurseDays],
          ].map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="mt-1 font-semibold tabular-nums">
                {faNumber(Number(value))}
              </dd>
            </div>
          ))}
        </dl>
      </details>
      <Callout icon={Info}>
        شیفت ME در پوشش صبح و عصر محاسبه می‌شود؛ منشی در پوشش پرستاری محاسبه
        نمی‌شود.
      </Callout>
      {report.undecidedNurseDays > 0 && (
        <Callout icon={AlertTriangle} tone="attention">
          تصمیم‌های برنامه کامل نیست؛ پوشش بر اساس تصمیم‌های ثبت‌شده محاسبه شده
          است.
        </Callout>
      )}
      <p className="text-xs text-muted-foreground">
        این گزارش فقط انطباق پوشش نیروی ثبت‌شده را نشان می‌دهد و آمادگی کلی
        برنامه برای نهایی‌سازی را تعیین نمی‌کند.
      </p>
      <form
        key={`${state.schedule}:${state.source}:${state.status}:${state.bucket}`}
        method="get"
        aria-label="فیلتر جزئیات پوشش"
        className="grid items-end gap-3 rounded-xl border bg-card p-4 sm:grid-cols-[1fr_1fr_auto]"
      >
        <input type="hidden" name="month" value={state.month} />
        <input type="hidden" name="schedule" value={state.schedule} />
        <input type="hidden" name="source" value={state.source} />
        <label className="min-w-0 space-y-1 text-sm">
          وضعیت پوشش
          <select
            className={selectClasses}
            name="status"
            defaultValue={state.status}
          >
            {Object.entries(STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="min-w-0 space-y-1 text-sm">
          نوبت پوشش
          <select
            className={selectClasses}
            name="bucket"
            defaultValue={state.bucket}
          >
            <option value="ALL">همه نوبت‌ها</option>
            {Object.entries(BUCKET_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label} ({value})
              </option>
            ))}
          </select>
        </label>
        <Button type="submit">اعمال فیلتر</Button>
      </form>
      <p role="status" className="text-sm text-muted-foreground">
        نمایش {faNumber(rows.length)} از {faNumber(report.rows.length)} نوبت ·
        خلاصه بالا همیشه مربوط به کل بازه و منبع انتخاب‌شده است.
      </p>
      {rows.length === 0 ? (
        <EmptyState
          icon={<Search />}
          title="نوبتی با این فیلتر وجود ندارد"
          description="فیلترها را تغییر دهید؛ خلاصه کل گزارش همچنان در بالا نمایش داده می‌شود."
          action={
            <Link
              className={buttonClasses("outline")}
              href={staffingHref(code, {
                ...state,
                status: "ALL",
                bucket: "ALL",
              })}
            >
              نمایش همه نوبت‌ها
            </Link>
          }
        />
      ) : (
        <>
          <div className="hidden min-w-0 rounded-xl border md:block">
            <div
              role="region"
              aria-label="جدول پوشش نیرو؛ قابل پیمایش افقی"
              tabIndex={0}
              className="overflow-x-auto rounded-xl focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-none"
            >
              <table
                className="w-full min-w-[48rem] text-start text-sm"
                aria-label="جزئیات پوشش نیرو"
              >
                <caption className="sr-only">
                  پوشش ثبت‌شده برای منبع و بازه واقعی گزارش؛ مقدار فاصله با واحد
                  نفر-نوبت است.
                </caption>
                <thead className="bg-muted/60 text-xs">
                  <tr>
                    {[
                      "تاریخ",
                      "نوبت",
                      "پوشش پرستاری ثبت‌شده",
                      "حداقل",
                      "حداکثر",
                      "وضعیت",
                      "مقدار کمبود یا مازاد",
                      "مبنای نیاز",
                    ].map((label) => (
                      <th key={label} scope="col" className="p-3 text-start">
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr
                      key={`${row.date}-${row.period}`}
                      data-staffing-row={`${row.date}-${row.period}`}
                      className="border-t"
                    >
                      <th scope="row" className="p-3 text-start font-normal">
                        <time dateTime={row.date}>
                          {formatJalaliDate(row.date, { weekday: true })}
                        </time>
                      </th>
                      <td className="p-3">
                        <ShiftChip
                          code={row.period}
                          label={BUCKET_LABELS[row.period]}
                        />
                      </td>
                      <td className="p-3 tabular-nums">
                        {faNumber(row.covered)}
                      </td>
                      <td className="p-3 tabular-nums">{faNumber(row.min)}</td>
                      <td className="p-3 tabular-nums">{maximum(row)}</td>
                      <td className="p-3">
                        <StaffingStatus row={row} />
                      </td>
                      <td className="p-3">{staffingGap(row)}</td>
                      <td className="p-3">{ORIGIN_LABELS[row.source]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <ul aria-label="پوشش روزانه نیرو" className="space-y-3 md:hidden">
            {staffingDays(rows).map((day) => (
              <li key={day.date} className="rounded-xl border bg-card p-4">
                <h3 className="mb-2 text-sm font-bold">
                  <time dateTime={day.date}>
                    {formatJalaliDate(day.date, { weekday: true })}
                  </time>
                </h3>
                <ul className="divide-y">
                  {day.buckets.map((row) => (
                    <li
                      key={row.period}
                      data-staffing-card={`${row.date}-${row.period}`}
                      className="space-y-2 py-3 text-sm"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <ShiftChip
                          code={row.period}
                          label={BUCKET_LABELS[row.period]}
                        />
                        <StaffingStatus row={row} />
                      </div>
                      <dl className="grid grid-cols-3 gap-2">
                        {[
                          ["پوشش ثبت‌شده", faNumber(row.covered)],
                          ["حداقل", faNumber(row.min)],
                          ["حداکثر", maximum(row)],
                        ].map(([label, value]) => (
                          <div key={label}>
                            <dt className="text-xs text-muted-foreground">
                              {label}
                            </dt>
                            <dd className="mt-1 tabular-nums">{value}</dd>
                          </div>
                        ))}
                      </dl>
                      <p className="font-medium">{staffingGap(row)}</p>
                      <p className="text-xs text-muted-foreground">
                        مبنای نیاز: {ORIGIN_LABELS[row.source]}
                      </p>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
