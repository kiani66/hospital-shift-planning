import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  Search,
} from "lucide-react";
import Link from "next/link";

import type {
  WorkforceReport,
  WorkforceReportRow,
} from "@/application/workforce-report/queries";
import { Button, buttonClasses } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import type { AssignmentCode } from "@/domain/shifts/shift-type";
import {
  faNumber,
  formatJalaliDate,
  formatJalaliDateTime,
  formatJalaliRange,
} from "@/features/calendar/jalali";
import { formatHours } from "@/features/my-shifts/presentation";
import { ROLE_LABELS } from "@/features/schedule/labels";
import { assignmentName, type ShiftLabels } from "@/features/shifts/catalog";
import { ShiftChip } from "@/features/shifts/shift-chip";

import { WorkforcePersonDialog } from "./person-dialog";
import {
  SOURCE_LABELS,
  SORT_LABELS,
  visibleWorkforceRows,
  workforceHref,
  workforceTotals,
  type WorkforceParams,
} from "./presentation";

export const selectClasses =
  "min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-base focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-none";
const codes = [
  "M",
  "E",
  "N",
  "ME",
  "OFF",
  "H",
] as const satisfies readonly AssignmentCode[];

export function ReportUnavailable({
  description,
  action,
}: {
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <EmptyState
      icon={<ClipboardList />}
      title="گزارش در دسترس نیست"
      description={description}
      action={action}
    />
  );
}

function Completeness({ complete }: { complete: boolean }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium">
      {complete ? (
        <CheckCircle2
          className="size-4 text-status-success-foreground"
          aria-hidden
        />
      ) : (
        <AlertTriangle
          className="size-4 text-health-attention-foreground"
          aria-hidden
        />
      )}
      {complete ? "تصمیم‌ها کامل" : "دارای روز تعیین‌نشده"}
    </span>
  );
}

export function WorkforceSource({ report }: { report: WorkforceReport }) {
  const provenance = report.provenance;
  return (
    <section
      aria-label="منبع گزارش"
      data-report-source={provenance.source}
      className="space-y-2"
    >
      <Callout
        as="div"
        tone={provenance.isProvisional ? "attention" : "success"}
        icon={provenance.isProvisional ? AlertTriangle : CheckCircle2}
      >
        <p className="font-bold">{SOURCE_LABELS[provenance.source]}</p>
        {provenance.isProvisional && (
          <p>این داده‌ها تأییدنشده‌اند و ممکن است تغییر کنند.</p>
        )}
        {provenance.approvedVersion && (
          <p className="mt-1 text-xs">
            {provenance.source === "REVISION_DRAFT" ? "نسخه رسمی مبنا" : "نسخه"}{" "}
            {faNumber(provenance.approvedVersion.versionNo)}
            {" · تأیید در "}
            {formatJalaliDateTime(
              provenance.approvedVersion.approvedAt,
              "Asia/Tehran",
            )}
          </p>
        )}
      </Callout>
      {!report.isComplete && (
        <p className="text-sm text-muted-foreground">
          گزارش ناقص است؛ روزهای تعیین‌نشده ساعت کاری ندارند و استراحت (OFF)
          محسوب نمی‌شوند.
        </p>
      )}
    </section>
  );
}

function PersonTotals({
  row,
  labels,
}: {
  row: WorkforceReportRow;
  labels: ShiftLabels;
}) {
  const items = [
    ...codes.map((code) => [
      assignmentName(code, labels),
      faNumber(row.counts[code]),
    ]),
    ["شیفت کاری", faNumber(row.workingShiftCount)],
    ["ساعات برنامه‌ریزی‌شده", formatHours(row.scheduledMinutes)],
    ["تعیین‌نشده (UNDECIDED)", faNumber(row.counts.UNDECIDED)],
  ];
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {items.map(([label, value]) => (
        <div key={label} className="rounded-md bg-muted/50 p-2">
          <dt className="text-xs text-muted-foreground">{label}</dt>
          <dd className="mt-1 text-sm font-semibold tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function WorkforceReportView({
  report,
  code,
  state,
  labels,
}: {
  report: WorkforceReport;
  code: string;
  state: WorkforceParams;
  labels: ShiftLabels;
}) {
  const totals = workforceTotals(report.rows);
  const rows = visibleWorkforceRows(report.rows, state);
  const person = state.person
    ? report.rows.find((row) => row.userId === state.person)
    : null;
  const detailHref = (id: string) =>
    workforceHref(code, { ...state, person: id });
  const cards = [
    ["اعضای فهرست برنامه", faNumber(totals.people)],
    ["شیفت‌های کاری", faNumber(totals.shifts)],
    ["ساعات برنامه‌ریزی‌شده", formatHours(totals.minutes)],
    ["روزهای تعیین‌نشده", faNumber(totals.undecided)],
  ];
  return (
    <div className="space-y-5">
      <div className="rounded-xl border bg-card p-4">
        <h2 className="font-bold">{report.schedule.label}</h2>
        <p className="mt-1 text-sm">
          بازه واقعی گزارش:{" "}
          {formatJalaliRange(report.period.start, report.period.end)} ·{" "}
          {faNumber(report.reportingDayCount)} روز
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          فقط همین برنامه؛ شامل همه اعضای فهرست تاریخی برنامه. ساعات،
          برنامه‌ریزی‌شده‌اند.
        </p>
      </div>
      <WorkforceSource report={report} />
      {report.rows.length === 0 ? (
        <ReportUnavailable description="فهرست این برنامه عضو ندارد؛ گزارشی برای نمایش موجود نیست." />
      ) : (
        <>
          <dl
            aria-label="خلاصه کل فهرست برنامه"
            className="grid grid-cols-2 gap-3 xl:grid-cols-4"
          >
            {cards.map(([label, value]) => (
              <div key={label} className="rounded-xl border bg-card p-4">
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className="mt-2 text-lg font-bold tabular-nums sm:text-xl">
                  {value}
                </dd>
              </div>
            ))}
          </dl>
          {totals.recorded === 0 && (
            <Callout icon={ClipboardList} tone="info">
              هنوز هیچ تصمیمی ثبت نشده است؛ همه اعضا در گزارش حضور دارند و روزها
              تعیین‌نشده‌اند.
            </Callout>
          )}
          {totals.recorded > 0 && totals.shifts === 0 && (
            <Callout icon={ClipboardList} tone="info">
              هیچ شیفت کاری ثبت نشده است؛ تصمیم‌های استراحت و مرخصی در جدول
              مشخص‌اند.
            </Callout>
          )}
          <form
            method="get"
            className="grid items-end gap-3 rounded-xl border bg-card p-4 sm:grid-cols-2 xl:grid-cols-[2fr_1fr_1fr_auto]"
            aria-label="جست‌وجو و مرتب‌سازی پرسنل"
          >
            <input type="hidden" name="month" value={state.month} />
            <input type="hidden" name="schedule" value={state.schedule} />
            <input type="hidden" name="source" value={state.source} />
            <label className="space-y-1 text-sm">
              جست‌وجوی نام یا شماره پرسنلی
              <Input
                id="workforce-search"
                name="q"
                defaultValue={state.q}
                maxLength={200}
                placeholder="نام یا شماره پرسنلی"
              />
            </label>
            <label className="space-y-1 text-sm">
              مرتب‌سازی
              <select
                className={selectClasses}
                name="sort"
                defaultValue={state.sort}
              >
                {Object.entries(SORT_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-sm">
              ترتیب
              <select
                className={selectClasses}
                name="order"
                defaultValue={state.order}
              >
                <option value="asc">صعودی</option>
                <option value="desc">نزولی</option>
              </select>
            </label>
            <Button type="submit">
              <Search className="size-4" aria-hidden />
              اعمال
            </Button>
          </form>
          <p className="text-sm text-muted-foreground">
            {faNumber(rows.length)} از {faNumber(report.rows.length)} نفر ·
            خلاصه بالا همیشه مربوط به کل فهرست برنامه است.
          </p>
          {rows.length === 0 ? (
            <EmptyState
              icon={<Search />}
              title="نتیجه‌ای پیدا نشد"
              description="نام یا شماره پرسنلی دیگری جست‌وجو کنید."
              action={
                <Link
                  className={buttonClasses("outline")}
                  href={workforceHref(code, {
                    ...state,
                    q: "",
                    person: undefined,
                  })}
                >
                  پاک کردن جست‌وجو
                </Link>
              }
            />
          ) : (
            <>
              <div className="hidden min-w-0 rounded-xl border md:block">
                <p className="border-b p-3 text-xs text-muted-foreground">
                  برای دیدن همه ستون‌ها، جدول را افقی پیمایش کنید.
                </p>
                <div
                  role="region"
                  aria-label="جدول پرسنل؛ برای دیدن همه ستون‌ها افقی پیمایش کنید"
                  tabIndex={0}
                  className="overflow-x-auto rounded-xl focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-none"
                >
                  <table
                    className="w-full min-w-[68rem] text-start text-sm"
                    aria-label="گزارش پرسنل"
                  >
                    <caption className="sr-only">
                      همه شمارش‌ها برای بازه واقعی همین برنامه و منبع
                      انتخاب‌شده‌اند.
                    </caption>
                    <thead className="bg-muted/60 text-xs">
                      <tr>
                        <th scope="col" className="p-3 text-start">
                          نام و شماره پرسنلی
                        </th>
                        <th scope="col" className="p-3 text-start">
                          نقش در برنامه
                        </th>
                        {codes.slice(0, 4).map((c) => (
                          <th key={c} scope="col" className="p-2">
                            <abbr
                              title={labels[c]}
                              className="cursor-help"
                              dir="ltr"
                            >
                              {c}
                            </abbr>
                          </th>
                        ))}
                        <th scope="col" className="p-2">
                          شیفت کاری
                        </th>
                        <th scope="col" className="p-2">
                          ساعات برنامه‌ریزی‌شده
                        </th>
                        {codes.slice(4).map((c) => (
                          <th key={c} scope="col" className="p-2">
                            <abbr
                              title={labels[c]}
                              className="cursor-help"
                              dir="ltr"
                            >
                              {c}
                            </abbr>
                          </th>
                        ))}
                        <th scope="col" className="p-2">
                          <abbr title="UNDECIDED — بدون تصمیم ثبت‌شده">
                            تعیین‌نشده
                          </abbr>
                        </th>
                        <th scope="col" className="p-3">
                          کامل بودن تصمیم‌ها
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => (
                        <tr
                          key={row.userId}
                          className="border-t hover:bg-accent/40"
                          data-person-row={row.userId}
                        >
                          <th
                            scope="row"
                            className="p-3 text-start font-normal"
                          >
                            <Link
                              aria-haspopup="dialog"
                              data-workforce-person={row.userId}
                              href={detailHref(row.userId)}
                              scroll={false}
                              className="inline-flex min-h-11 flex-col justify-center font-semibold text-primary underline-offset-4 hover:underline focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-none"
                            >
                              {row.displayName}
                              {row.personnelNumber && (
                                <span
                                  dir="ltr"
                                  className="text-start text-xs font-normal text-muted-foreground"
                                >
                                  {row.personnelNumber}
                                </span>
                              )}
                            </Link>
                            {!row.isActive && (
                              <span className="block text-xs text-muted-foreground">
                                غیرفعال
                              </span>
                            )}
                          </th>
                          <td className="p-3">{ROLE_LABELS[row.role]}</td>
                          {codes.slice(0, 4).map((c) => (
                            <td
                              key={c}
                              className="p-2 text-center tabular-nums"
                            >
                              {faNumber(row.counts[c])}
                            </td>
                          ))}
                          <td className="p-2 text-center tabular-nums">
                            {faNumber(row.workingShiftCount)}
                          </td>
                          <td className="p-2 text-center tabular-nums">
                            {formatHours(row.scheduledMinutes)}
                          </td>
                          {codes.slice(4).map((c) => (
                            <td
                              key={c}
                              className="p-2 text-center tabular-nums"
                            >
                              {faNumber(row.counts[c])}
                            </td>
                          ))}
                          <td className="p-2 text-center tabular-nums">
                            {faNumber(row.counts.UNDECIDED)}
                          </td>
                          <td className="p-3">
                            <Completeness complete={row.isComplete} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              <ul aria-label="کارت‌های پرسنل" className="space-y-3 md:hidden">
                {rows.map((row) => (
                  <li
                    key={row.userId}
                    className="space-y-3 rounded-xl border bg-card p-4"
                    data-person-card={row.userId}
                  >
                    <div>
                      <Link
                        aria-haspopup="dialog"
                        data-workforce-person={row.userId}
                        href={detailHref(row.userId)}
                        scroll={false}
                        className="inline-flex min-h-11 items-center font-bold text-primary underline-offset-4 hover:underline focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-none"
                      >
                        {row.displayName}
                      </Link>
                      <p className="text-sm text-muted-foreground">
                        {ROLE_LABELS[row.role]}
                        {!row.isActive && " · غیرفعال"}
                      </p>
                      {row.personnelNumber && (
                        <p className="text-sm">
                          شماره پرسنلی: <bdi>{row.personnelNumber}</bdi>
                        </p>
                      )}
                    </div>
                    <PersonTotals row={row} labels={labels} />
                    <Completeness complete={row.isComplete} />
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
      {person && (
        <WorkforcePersonDialog
          title={`جزئیات پرسنل — ${person.displayName}`}
          personId={person.userId}
          closeHref={workforceHref(code, { ...state, person: undefined })}
        >
          <p className="text-sm">
            {ROLE_LABELS[person.role]}
            {person.personnelNumber && (
              <>
                {" "}
                · شماره پرسنلی: <bdi>{person.personnelNumber}</bdi>
              </>
            )}
          </p>
          <p className="text-sm">
            {formatJalaliRange(report.period.start, report.period.end)}
          </p>
          <WorkforceSource report={report} />
          <PersonTotals row={person} labels={labels} />
          <Completeness complete={person.isComplete} />
          <ol
            aria-label="تصمیم‌های روزانه پرسنل"
            className="divide-y rounded-lg border px-3"
          >
            {person.days.map((day) => (
              <li
                key={day.date}
                className="flex min-h-12 flex-wrap items-center justify-between gap-2 py-2 text-sm"
              >
                <time dateTime={day.date}>
                  {formatJalaliDate(day.date, { weekday: true })}
                </time>
                {day.decision === null ? (
                  <span className="text-muted-foreground">
                    تعیین‌نشده <bdi>(UNDECIDED)</bdi>
                  </span>
                ) : (
                  <ShiftChip code={day.decision} label={labels[day.decision]} />
                )}
              </li>
            ))}
          </ol>
        </WorkforcePersonDialog>
      )}
    </div>
  );
}
