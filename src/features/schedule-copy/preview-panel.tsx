"use client";

import type { ScheduleCopyPreview } from "@/application/schedules/copy";
import { Button } from "@/components/ui/button";
import { toDiagnostic } from "@/domain/rules/diagnostic";
import { violationKey, type Violation } from "@/domain/rules/violation";
import type { DatePeriod } from "@/domain/shared/period";
import {
  faNumber,
  formatJalaliDate,
  formatJalaliRange,
} from "@/features/calendar/jalali";
import {
  findingMessage,
  ruleTitle,
} from "@/features/schedule-review/presentation";
import type { ShiftLabels } from "@/features/shifts/catalog";
import { ShiftChip } from "@/features/shifts/shift-chip";
import { COPY_REASONS } from "./presentation";

const outcomes = {
  CREATE: "قابل انتقال",
  UNCHANGED: "بدون تغییر",
  SKIP: "صرف‌نظر",
  CONFLICT: "تداخل؛ حفظ مقصد",
};

export function CopyPreviewPanel({
  preview,
  period,
  shiftLabels,
  pending,
  onApply,
}: {
  preview: ScheduleCopyPreview;
  period: DatePeriod;
  shiftLabels: ShiftLabels;
  pending: boolean;
  onApply: () => void;
}) {
  const names = new Map(preview.nurses.map((n) => [n.userId, n.displayName]));
  const skippedLeaveCount = preview.rows.filter(
    (row) => row.reason === "SOURCE_LEAVE_NOT_COPIED",
  ).length;
  function finding(v: Violation) {
    const diagnostic = toDiagnostic(v, period);
    return findingMessage(
      {
        ...diagnostic,
        nurses: diagnostic.nurseIds.map((userId) => ({
          userId,
          displayName: names.get(userId) ?? "—",
        })),
      },
      shiftLabels,
    );
  }
  return (
    <section
      aria-label="نتیجه پیش‌نمایش کپی"
      className="flex flex-col gap-3 border-t pt-4"
    >
      <p className="text-sm">
        {preview.sourceLabel} ← {preview.targetLabel}
      </p>
      <p className="text-xs text-muted-foreground">
        روزهای مقصد:{" "}
        {formatJalaliRange(
          preview.targetDates[0]!,
          preview.targetDates.at(-1)!,
        )}
      </p>
      <p role="status" className="text-sm font-semibold">
        {faNumber(preview.sourceAssignmentCount)} انتساب بررسی شد ·{" "}
        {faNumber(preview.proposed.length)}{" "}
        {preview.blockingViolations.length > 0
          ? "پیشنهاد انتقال (مسدود)"
          : "قابل انتقال"}{" "}
        · {faNumber(preview.unchangedCount)} بدون تغییر ·{" "}
        {faNumber(preview.skippedCount)} صرف‌نظر ·{" "}
        {faNumber(preview.conflictCount)} تداخل
      </p>
      <p className="text-sm">
        {faNumber(preview.affectedNurseIds.length)} نفر ·{" "}
        {faNumber(preview.targetDates.length)} روز مقصد
      </p>
      {skippedLeaveCount > 0 && (
        <p className="text-sm text-muted-foreground">
          {faNumber(skippedLeaveCount)} مرخصی مبدأ کپی نمی‌شود. این سلول‌ها
          در صورت خالی بودن مقصد، تعیین‌نشده باقی می‌مانند؛ استراحت خودکار ثبت نمی‌شود.
        </p>
      )}
      {!!preview.correctableViolations.length && (
        <div
          role="alert"
          className="rounded-md border border-destructive p-3 text-sm"
        >
          <p className="font-semibold">
            این برنامه دارای مغایرت با قوانین شیفت‌بندی است. می‌توانید برنامه را
            کپی کنید و سپس مغایرت‌ها را برطرف کنید. تا زمان رفع خطاهای الزامی،
            نهایی‌سازی برنامه مجاز نیست.
          </p>
          <p>
            {faNumber(preview.correctableViolations.length)} مغایرت نیازمند
            اصلاح
          </p>
          <ul className="max-h-64 list-inside list-disc overflow-y-auto">
            {preview.correctableViolations.map((v) => (
              <li key={violationKey(v)}>
                {ruleTitle(v)}: {finding(v)}
                {v.rule === "NIGHT_REST" &&
                  v.nightDate < period.start &&
                  " این شیفت شب در برنامه ماه قبل ثبت شده است."}
                {v.rule === "NIGHT_REST" &&
                  v.date > period.end &&
                  " شیفت روز بعد در برنامه ماه بعد ثبت شده است."}
              </li>
            ))}
          </ul>
        </div>
      )}
      {!!preview.blockingViolations.length && (
        <div
          role="alert"
          className="rounded-md border border-destructive p-3 text-sm"
        >
          <p className="font-semibold">
            نقض قانون؛ اعمال این مجموعه مجاز نیست.
          </p>
          <ul className="list-inside list-disc">
            {preview.blockingViolations.map((v) => (
              <li key={violationKey(v)}>
                {ruleTitle(v)}: {finding(v)}
              </li>
            ))}
          </ul>
        </div>
      )}
      {preview.assessment.warnings.map((v) => (
        <p key={violationKey(v)} className="text-sm">
          هشدار: {ruleTitle(v)}: {finding(v)}
        </p>
      ))}
      {!!preview.preferenceNotes.length && (
        <details>
          <summary className="min-h-11 cursor-pointer text-sm">
            {faNumber(preview.preferenceNotes.length)} مغایرت با ترجیح مقصد
            (توصیه‌ای)
          </summary>
          <ul className="list-inside list-disc text-sm">
            {preview.preferenceNotes.map((n) => (
              <li key={`${n.nurseId}:${n.date}`}>
                {names.get(n.nurseId)} · {formatJalaliDate(n.date)}: انتساب با
                ترجیح این روز متفاوت است؛ مانع ثبت نیست.
              </li>
            ))}
          </ul>
        </details>
      )}
      <details open={preview.rows.some((r) => r.outcome !== "CREATE")}>
        <summary className="min-h-11 cursor-pointer text-sm">
          جزئیات انتساب‌ها و موارد منتقل‌نشده
        </summary>
        <ul className="max-h-64 divide-y overflow-y-auto text-sm">
          {preview.rows.map((r) => (
            <li
              key={`${r.nurseId}:${r.sourceDate}`}
              className="flex flex-wrap items-center gap-2 py-3"
            >
              <span className="font-semibold">{names.get(r.nurseId)}</span>
              <ShiftChip code={r.shift} label={shiftLabels[r.shift]} />
              <span>
                {formatJalaliDate(r.sourceDate)} ←{" "}
                {r.targetDate
                  ? formatJalaliDate(r.targetDate)
                  : "روز مقصد وجود ندارد"}
              </span>
              <span>
                {r.outcome === "CREATE" && preview.blockingViolations.length > 0
                  ? "پیشنهاد انتقال؛ مجموعه مسدود است"
                  : outcomes[r.outcome]}
              </span>
              {r.reason && (
                <span className="w-full text-muted-foreground">
                  {COPY_REASONS[r.reason]}
                </span>
              )}
            </li>
          ))}
        </ul>
      </details>
      <details>
        <summary className="min-h-11 cursor-pointer text-sm">
          پوشش روزهای مقصد پس از کپی
        </summary>
        <ul className="max-h-48 overflow-y-auto text-sm">
          {preview.coverage.map((d) => (
            <li key={d.date} className="py-1">
              {formatJalaliDate(d.date)}:{" "}
              {d.periods
                .map(
                  (p) =>
                    `${shiftLabels[p.period]} ${faNumber(p.before)} ← ${faNumber(p.after)}${p.bounds ? ` (حداقل ${p.bounds.min == null ? "—" : faNumber(p.bounds.min)}، حداکثر ${p.bounds.max == null ? "—" : faNumber(p.bounds.max)})` : ""}`,
                )
                .join("، ")}
            </li>
          ))}
        </ul>
      </details>
      {!preview.canApply && preview.blockingViolations.length === 0 && (
        <p className="text-sm">انتساب قابل انتقالی وجود ندارد.</p>
      )}
      <p className="text-xs text-muted-foreground">
        فقط انتساب‌های قابل انتقال ثبت می‌شوند. وضعیت برنامه تغییر نمی‌کند.
        موارد منتقل‌نشده را می‌توانید با ویرایش عادی بررسی کنید.
      </p>
      <Button disabled={!preview.canApply || pending} onClick={onApply}>
        {pending ? "در حال ثبت…" : "تأیید و کپی برنامه"}
      </Button>
    </section>
  );
}
