"use client";

import Link from "next/link";
import type { Route } from "next";
import { useActionState, useId, useState } from "react";

import { Button, buttonClasses } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  faNumber,
  formatJalaliDate,
  JALALI_MONTHS,
  MAX_JALALI_YEAR,
  MIN_JALALI_YEAR,
  type JalaliMonth,
} from "@/features/calendar/jalali";
import { toDiagnostic } from "@/domain/rules/diagnostic";
import type { ShiftLabels } from "@/features/shifts/catalog";
import { ROLE_LABELS } from "@/features/schedule/labels";
import {
  RULE_TITLES,
  findingMessage,
} from "@/features/schedule-review/presentation";
import { commitExcelAction, previewExcelAction } from "./actions";
import type { ScheduleImportPreview } from "@/application/schedule-import/import";

function ConfirmImport({ preview }: { preview: ScheduleImportPreview }) {
  const [state, action, pending] = useActionState(commitExcelAction, {
    status: "idle",
  });
  const id = useId();
  if (state.status === "committed")
    return (
      <div role="status" className="space-y-3 rounded-xl border p-4">
        <p>
          {faNumber(state.assignments)} تصمیم روزانه ثبت شد. وضعیت تأیید و
          انتشار برنامه تغییر نکرد.
        </p>
        <Link
          className={buttonClasses()}
          href={
            `/departments/${preview.department.code}/schedule?schedule=${state.scheduleId}` as Route
          }
        >
          مشاهده برنامه ماهانه
        </Link>
      </div>
    );
  return (
    <form action={action} className="space-y-4 rounded-xl border p-4">
      <input
        type="hidden"
        name="payload"
        value={JSON.stringify(preview.payload)}
      />
      <p>
        {preview.createsSchedule
          ? "برنامه جدید در وضعیت پیش‌نویس ایجاد می‌شود."
          : "تصمیم‌ها در برنامه خالی موجود ثبت می‌شوند؛ وضعیت آن تغییر نمی‌کند."}
      </p>
      <label htmlFor={id} className="flex items-start gap-2">
        <input
          id={id}
          name="confirm"
          type="checkbox"
          required
          disabled={pending || !preview.committable}
          className="mt-1 size-4"
        />
        پیش‌نمایش و هشدارها را بررسی کرده‌ام؛ ثبت همه تصمیم‌ها و تبدیل خانه‌های
        خالی روز به OFF را تأیید می‌کنم.
      </label>
      {state.status === "error" && (
        <p role="alert" className="text-destructive">
          {state.message}
        </p>
      )}
      <Button type="submit" disabled={pending || !preview.committable}>
        {pending ? "در حال ثبت…" : "تأیید و ثبت برنامه"}
      </Button>
    </form>
  );
}
function Preview({
  preview,
  shiftLabels,
}: {
  preview: ScheduleImportPreview;
  shiftLabels: ShiftLabels;
}) {
  return (
    <section aria-label="پیش‌نمایش برنامه ماهانه" className="min-w-0 space-y-5">
      <h2 className="text-lg font-semibold">
        پیش‌نمایش — {preview.department.name} — {preview.label}
      </h2>
      <dl className="grid grid-cols-2 gap-3 rounded-xl border p-4 sm:grid-cols-4">
        {[
          ["پرسنل", preview.personnel.total],
          ["پرستار", preview.personnel.nurses],
          ["سرپرستار", preview.personnel.headNurses],
          ["منشی", preview.personnel.secretaries],
          ["تصمیم روزانه", preview.assignments],
          ...Object.entries(preview.counts).map(([code, count]) => [
            code === "H"
              ? "مرخصی (H)"
              : code === "OFF"
                ? "استراحت (OFF)"
                : code,
            count,
          ]),
        ].map(([label, count]) => (
          <div key={label}>
            <dt className="text-sm text-muted-foreground">{label}</dt>
            <dd className="font-semibold">{faNumber(Number(count))}</dd>
          </div>
        ))}
      </dl>
      {(preview.blocking.length > 0 ||
        preview.issues.length > 0 ||
        preview.rows.some((r) => r.errors.length > 0)) && (
        <div
          role="alert"
          className="space-y-2 rounded-xl border border-destructive/40 p-4 text-destructive"
        >
          <h3 className="font-semibold">خطاهای مانع ورود</h3>
          <ul className="list-inside list-disc space-y-1">
            {preview.blocking.map((message, i) => (
              <li key={`b${i}`}>{message}</li>
            ))}
            {preview.issues.map((issue, i) => (
              <li key={`c${i}`}>
                ردیف {faNumber(issue.row)}، خانه <bdi>{issue.cell}</bdi>
                {issue.date ? `، ${formatJalaliDate(issue.date)}` : ""}:{" "}
                {issue.message}
              </li>
            ))}
            {preview.rows.flatMap((r) =>
              r.errors.map((error, i) => (
                <li key={`${r.line}:${i}`}>
                  ردیف {faNumber(r.line)} — {r.displayName} (
                  <bdi>{r.personnelNumber}</bdi>): {error}
                </li>
              )),
            )}
          </ul>
        </div>
      )}
      <details
        className="rounded-xl border p-4"
        open={preview.violations.length > 0}
      >
        <summary className="cursor-pointer font-semibold">
          یافته‌های برنامه‌ریزی ({faNumber(preview.violations.length)})
        </summary>
        <p className="my-3 text-sm text-muted-foreground">
          مانند ورود دستی، یافته‌های برنامه‌ریزی اجازه ذخیره پیش‌نویس را
          می‌دهند؛ قوانین سخت همچنان مانع نهایی‌سازی و ارسال هستند. پوشش فقط
          پرستار و سرپرستار را می‌شمارد. پرسنل غایب از فایل، تعیین‌نشده
          می‌مانند.
        </p>
        <div className="max-h-72 overflow-y-auto">
          <ul className="space-y-2 text-sm">
            {preview.violations.map((v, i) => (
              <li key={i}>
                {formatJalaliDate(v.date)} — {RULE_TITLES[v.rule]}:{" "}
                {findingMessage(
                  {
                    ...toDiagnostic(v, {
                      start: preview.dates[0]!,
                      end: preview.dates[preview.dates.length - 1]!,
                    }),
                    nurses: toDiagnostic(v, {
                      start: preview.dates[0]!,
                      end: preview.dates[preview.dates.length - 1]!,
                    }).nurseIds.map((id) => ({
                      userId: id,
                      displayName:
                        preview.rows.find((r) => r.userId === id)
                          ?.displayName ?? "عضو فهرست برنامه",
                    })),
                  },
                  shiftLabels,
                )}{" "}
                ({v.severity === "error" ? "قانون سخت" : "هشدار"})
              </li>
            ))}
          </ul>
        </div>
      </details>
      <div
        role="region"
        aria-label="جدول پیش‌نمایش ماه"
        tabIndex={0}
        className="max-w-full overflow-x-auto rounded-xl border"
      >
        <table className="w-max min-w-full border-collapse text-sm">
          <caption className="sr-only">
            برنامه ماهانه؛ ستون‌ها روزهای {preview.label}
          </caption>
          <thead className="bg-muted">
            <tr>
              <th scope="col" className="p-3 text-start">
                پرسنل / نقش
              </th>
              {preview.dates.map((date, i) => (
                <th key={date} scope="col" className="min-w-12 p-2">
                  {faNumber(i + 1)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {preview.rows.map((row) => (
              <tr key={row.line} className="border-t">
                <th scope="row" className="max-w-64 p-3 text-start">
                  <span className="block">{row.displayName}</span>
                  <span className="block font-normal text-muted-foreground">
                    <bdi>{row.personnelNumber}</bdi> —{" "}
                    {row.role ? ROLE_LABELS[row.role] : "نامشخص"}
                  </span>
                </th>
                {row.days.map((code, i) => (
                  <td
                    key={i}
                    className={`p-2 text-center font-mono ${code === "H" ? "bg-shift-leave text-shift-leave-foreground" : code === "OFF" ? "bg-shift-off text-shift-off-foreground" : code === "ME" ? "bg-shift-me text-shift-me-foreground" : code === "M" ? "bg-shift-m text-shift-m-foreground" : code === "E" ? "bg-shift-e text-shift-e-foreground" : "bg-shift-n text-shift-n-foreground"}`}
                  >
                    <bdi>
                      {preview.issues.some(
                        (issue) =>
                          issue.row === row.line && issue.day === i + 1,
                      )
                        ? "خطا"
                        : code}
                    </bdi>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <details className="rounded-xl border p-4">
        <summary className="cursor-pointer font-semibold">
          پوشش پرستاری روزانه
        </summary>
        <div className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
          {preview.coverage.map((day) => (
            <p key={day.date}>
              {formatJalaliDate(day.date)}:{" "}
              <bdi>
                M {day.coverage.M} / E {day.coverage.E} / N {day.coverage.N}
              </bdi>
            </p>
          ))}
        </div>
      </details>
      <ConfirmImport preview={preview} />
    </section>
  );
}
export function MonthlyScheduleImport({
  department,
  suggested,
  shiftLabels,
}: {
  department: { id: string; name: string };
  suggested: JalaliMonth;
  shiftLabels: ShiftLabels;
}) {
  const [state, action, pending] = useActionState(previewExcelAction, {
    status: "idle",
  });
  const [year, setYear] = useState(suggested.year);
  const [month, setMonth] = useState(suggested.month);
  const yearId = useId();
  const monthId = useId();
  const fileId = useId();
  const template = `/api/schedule-import/template?year=${year}&month=${month}`;
  const selectClass =
    "min-h-11 w-full rounded-md border border-input bg-background px-3 text-base";
  return (
    <div dir="rtl" className="min-w-0 space-y-6">
      <p className="text-sm leading-relaxed text-muted-foreground">
        بخش: {department.name}. ورود ماه‌های گذشته و آینده پشتیبانی می‌شود.
        شماره پرسنلی باید تأییدشده باشد؛ هیچ حساب یا عضویتی با این ورود ایجاد
        نمی‌شود.
      </p>
      <form action={action} className="space-y-4 rounded-xl border p-4">
        <input type="hidden" name="departmentId" value={department.id} />
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor={yearId}>سال شمسی</Label>
            <Input
              id={yearId}
              name="year"
              type="number"
              min={MIN_JALALI_YEAR}
              max={MAX_JALALI_YEAR}
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={monthId}>ماه</Label>
            <select
              id={monthId}
              name="month"
              value={month}
              onChange={(e) => setMonth(Number(e.target.value))}
              className={selectClass}
            >
              {JALALI_MONTHS.map((name, i) => (
                <option key={name} value={i + 1}>
                  {name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex flex-wrap gap-3">
          <a className="text-sm underline" href={template} download>
            دانلود الگوی Excel این ماه
          </a>
          <a
            className="text-sm underline"
            href={`${template}&sample=1`}
            download
          >
            دانلود نمونه آموزشی (پرسنل فرضی)
          </a>
        </div>
        <p className="text-sm leading-relaxed">
          سرستون‌ها: شماره پرسنلی، نام و نام خانوادگی، سپس شماره روزها. کدهای
          مجاز: <bdi>M / E / N / ME / OFF / H</bdi>. خانه خالی در روزهای این ماه
          به معنای استراحت (OFF) است. نمونه‌های دانلودی شماره واقعی NICU نیستند.
        </p>
        <div className="space-y-2">
          <Label htmlFor={fileId}>فایل برنامه ماهانه (.xlsx)</Label>
          <Input
            id={fileId}
            name="file"
            type="file"
            accept=".xlsx"
            required
            className="h-auto min-h-11"
          />
        </div>
        <Button type="submit" disabled={pending}>
          {pending ? "در حال بررسی…" : "بارگذاری و بررسی فایل"}
        </Button>
        {state.status === "error" && (
          <p role="alert" className="text-destructive">
            {state.message}
          </p>
        )}
      </form>
      {state.status === "preview" && (
        <Preview
          key={state.preview.payload.proof.signature}
          preview={state.preview}
          shiftLabels={shiftLabels}
        />
      )}
    </div>
  );
}
