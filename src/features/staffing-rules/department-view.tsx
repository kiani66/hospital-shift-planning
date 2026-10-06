import { ArrowLeft, CircleCheck, Info } from "lucide-react";
import Link from "next/link";
import type { Route } from "next";

import type { RuleSetApplicationPreview } from "@/application/staffing-rules/apply";
import type { DepartmentCoverageRules } from "@/application/staffing-rules/department";
import { Badge } from "@/components/ui/badge";
import { Callout } from "@/components/ui/callout";
import {
  faNumber,
  formatJalaliDate,
  formatJalaliRange,
} from "@/features/calendar/jalali";
import { SCHEDULE_STATUS_LABELS } from "@/features/schedule/labels";
import { cn } from "@/lib/utils";

import { ApplyConfirmForm } from "./apply-confirm";
import { RuleSetHistory } from "./history-view";
import {
  BUCKET_NAMES,
  applyRefusalText,
  dayTypeSummary,
  scopeLabel,
  versionLabel,
} from "./presentation";
import { RuleSetVersionCard } from "./version-card";

const focusRing =
  "focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-none";

/** "پیش‌فرض بیمارستان · نسخه ۱" */
const versionName = (
  v: { departmentId: string | null; versionNo: number },
  departmentName: string,
) =>
  `${v.departmentId === null ? scopeLabel(null) : scopeLabel(departmentName)} · ${versionLabel(v.versionNo)}`;

/** The impact of an Apply, in aggregates only (D107, D108): counts, dates, buckets. */
function ImpactTable({ preview }: { preview: RuleSetApplicationPreview }) {
  const rows: [string, number, number][] = [
    [
      "تصمیم تعیین‌نشده",
      preview.impact.before.undecided,
      preview.impact.after.undecided,
    ],
    [
      "کمبود نیرو (نوبت)",
      preview.impact.before.shortages,
      preview.impact.after.shortages,
    ],
    [
      "مازاد نیرو (نوبت)",
      preview.impact.before.overstaffing,
      preview.impact.after.overstaffing,
    ],
    [
      "نقض قانون",
      preview.impact.before.ruleViolations,
      preview.impact.after.ruleViolations,
    ],
    [
      "روزهای آماده",
      preview.impact.before.readyDays,
      preview.impact.after.readyDays,
    ],
  ];
  return (
    <table className="w-full max-w-lg text-sm">
      <caption className="sr-only">اثر اعمال نسخه</caption>
      <thead>
        <tr className="text-xs text-muted-foreground">
          <th scope="col" className="py-1 text-start font-medium">
            مورد
          </th>
          <th scope="col" className="py-1 text-start font-medium">
            با قوانین فعلی
          </th>
          <th scope="col" className="py-1 text-start font-medium">
            با نسخه انتخابی
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([label, before, after]) => (
          <tr key={label} className="border-t">
            <th scope="row" className="py-1 text-start font-normal">
              {label}
            </th>
            <td className="py-1 tabular-nums">{faNumber(before)}</td>
            <td
              className={cn(
                "py-1 font-semibold tabular-nums",
                after !== before && "text-primary",
              )}
            >
              {faNumber(after)}
            </td>
          </tr>
        ))}
        <tr className="border-t">
          <th scope="row" className="py-1 text-start font-normal">
            شیفت‌های تغییرکرده
          </th>
          <td className="py-1 tabular-nums" colSpan={2}>
            {faNumber(preview.assignmentsChanged)}
          </td>
        </tr>
      </tbody>
    </table>
  );
}

/** PREVIEW (no write) and, when allowed, the explicit confirmation (D107). */
export function ApplyPreview({
  preview,
  departmentName,
  departmentCode,
  closeHref,
}: {
  preview: RuleSetApplicationPreview;
  departmentName: string;
  departmentCode: string;
  closeHref: Route;
}) {
  const current = versionName(preview.current, departmentName);
  const target = versionName(preview.target, departmentName);
  const introduced = preview.impact.introduced;
  return (
    <section
      aria-labelledby="apply-preview-title"
      data-apply-preview
      className="flex flex-col gap-3 rounded-xl border border-primary/30 bg-brand-soft/40 p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="apply-preview-title" className="text-base font-semibold">
          پیش‌نمایش اعمال نسخه بر «{preview.label}»
        </h2>
        <Link
          href={closeHref}
          className={cn(
            "text-sm text-primary underline-offset-4 hover:underline",
            focusRing,
          )}
        >
          بستن پیش‌نمایش
        </Link>
      </div>
      <p className="flex flex-wrap items-center gap-2 text-sm">
        <span>
          فعلی: <strong>{current}</strong>
        </span>
        <ArrowLeft aria-hidden="true" className="size-4 ltr:-scale-x-100" />
        <span>
          انتخابی: <strong>{target}</strong>
        </span>
        {preview.rollback && (
          <Badge tone="warning" size="sm">
            بازگشت به نسخه پیشین
          </Badge>
        )}
      </p>
      <p className="text-sm text-muted-foreground">
        روزهای عادی در نسخه انتخابی:{" "}
        {dayTypeSummary(preview.target.content.normal)}
      </p>
      <p className="text-xs text-muted-foreground">
        این پیش‌نمایش چیزی را ذخیره نمی‌کند و فقط شمار موارد را نشان می‌دهد
        (بدون نام پرسنل).
      </p>
      <ImpactTable preview={preview} />
      {introduced.length > 0 ? (
        <div className="text-sm">
          <p className="font-medium">مشکلات پوشش تازه یا بدترشده:</p>
          <ul className="mt-1 list-disc ps-5">
            {introduced.slice(0, 20).map((p) => (
              <li key={`${p.date}${p.period}`}>
                {formatJalaliDate(p.date, { weekday: true })} ·{" "}
                {BUCKET_NAMES[p.period]}: {faNumber(p.covered)} نفر —{" "}
                {p.kind === "SHORTAGE"
                  ? `کمبود ${faNumber(p.amount)} نفر`
                  : `مازاد ${faNumber(p.amount)} نفر`}
              </li>
            ))}
            {introduced.length > 20 && (
              <li>و {faNumber(introduced.length - 20)} مورد دیگر</li>
            )}
          </ul>
        </div>
      ) : (
        <p className="flex items-center gap-1.5 text-sm">
          <CircleCheck
            aria-hidden="true"
            className="size-4 text-health-valid-foreground"
          />
          مشکل پوشش تازه‌ای پدید نمی‌آید.
        </p>
      )}
      {preview.impact.becameNotReady.length > 0 && (
        <p className="text-sm">
          {faNumber(preview.impact.becameNotReady.length)} روزِ اکنون آماده،
          دیگر آماده نخواهد بود.
        </p>
      )}
      {preview.revisionDatesToAdd.length > 0 && (
        <p className="text-sm">
          {faNumber(preview.revisionDatesToAdd.length)} روز برای اصلاح به دامنه
          بازنگری افزوده می‌شود:{" "}
          {preview.revisionDatesToAdd
            .map((d) => formatJalaliDate(d))
            .join("، ")}
        </p>
      )}
      {preview.allowed.allowed ? (
        <ApplyConfirmForm
          scheduleId={preview.scheduleId}
          revision={preview.revision}
          fromVersionId={preview.current.versionId}
          toVersionId={preview.target.versionId}
          departmentCode={departmentCode}
          targetLabel={target}
        />
      ) : (
        <Callout role="note" tone="attention" icon={Info}>
          {applyRefusalText(preview.allowed.reason)}
        </Callout>
      )}
    </section>
  );
}

/**
 * The rule sets of one department (D108): what applies to new schedules,
 * every published or retired version (read-only), and each schedule's pin.
 * A Supervisor or Hospital Admin may preview and apply another version to a
 * schedule; a Head Nurse reads only.
 */
export function DepartmentCoverageRulesView({
  data,
  departmentName,
  pageHref,
  selectedScheduleId,
  preview,
}: {
  data: DepartmentCoverageRules;
  departmentName: string;
  /** This page; the preview form submits `?schedule=&target=` to it. */
  pageHref: Route;
  selectedScheduleId: string | null;
  preview: React.ReactNode;
}) {
  const name = (id: string) => {
    const v = data.versionNames.get(id);
    return v ? versionName(v, departmentName) : "—";
  };
  const labels = new Map(data.schedules.map((s) => [s.scheduleId, s.label]));
  return (
    <div className="flex flex-col gap-8">
      <Callout role="note" tone="info" icon={Info}>
        هر برنامه به یک نسخه از قوانین پوشش متصل است و با همان سنجیده می‌شود.
        انتشار نسخه تازه برنامه‌های موجود را تغییر نمی‌دهد. برنامه تازه بر پایه
        تاریخ شروع دوره، نسخه جاری را می‌گیرد
        {data.effectiveVersionId &&
          ` (اکنون: ${name(data.effectiveVersionId)})`}
        .
      </Callout>

      <section
        aria-labelledby="schedules-rules"
        className="flex flex-col gap-3"
      >
        <h2 id="schedules-rules" className="text-lg font-semibold">
          برنامه‌های بخش و قوانین متصل
        </h2>
        {data.schedules.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            هنوز برنامه‌ای ساخته نشده است.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {data.schedules.map((s) => {
              const targets = data.versions.filter(
                (v) => v.id !== s.pinnedVersionId,
              );
              return (
                <li
                  key={s.scheduleId}
                  data-schedule-rules={s.scheduleId}
                  className={cn(
                    "flex flex-col gap-2 rounded-xl border bg-card p-3 shadow-xs",
                    selectedScheduleId === s.scheduleId &&
                      "ring-2 ring-primary",
                  )}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{s.label}</span>
                    <span className="text-xs text-muted-foreground">
                      {formatJalaliRange(s.period.start, s.period.end)}
                    </span>
                    <Badge tone="neutral" size="sm">
                      {SCHEDULE_STATUS_LABELS[s.status]}
                    </Badge>
                  </div>
                  <p className="text-sm">
                    قوانین متصل: <strong>{name(s.pinnedVersionId)}</strong>
                    {s.suggestedVersionId && (
                      <span className="text-muted-foreground">
                        {" "}
                        · نسخه جاری برای این دوره: {name(s.suggestedVersionId)}
                      </span>
                    )}
                  </p>
                  {data.canApply && targets.length > 0 && (
                    <form
                      method="get"
                      className="flex flex-wrap items-end gap-2"
                      action={pageHref}
                    >
                      <input
                        type="hidden"
                        name="schedule"
                        value={s.scheduleId}
                      />
                      <label className="flex flex-col gap-1 text-xs">
                        اعمال نسخه دیگر
                        <select
                          name="target"
                          defaultValue={s.suggestedVersionId ?? targets[0]!.id}
                          className="h-10 rounded-md border border-input bg-background px-2 text-sm"
                        >
                          {targets.map((v) => (
                            <option key={v.id} value={v.id}>
                              {versionName(v, departmentName)}
                              {v.status === "RETIRED" ? " (بازنشسته)" : ""}
                            </option>
                          ))}
                        </select>
                      </label>
                      <button
                        type="submit"
                        className={cn(
                          "h-10 rounded-md border border-input bg-background px-3 text-sm hover:bg-accent",
                          focusRing,
                        )}
                      >
                        پیش‌نمایش
                      </button>
                    </form>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {preview}
      </section>

      <section aria-labelledby="versions-rules" className="flex flex-col gap-3">
        <h2 id="versions-rules" className="text-lg font-semibold">
          نسخه‌های قوانین (فقط خواندنی)
        </h2>
        {data.versions.map((v) => (
          <RuleSetVersionCard
            key={v.id}
            version={v}
            names={data.names}
            highlight={
              v.departmentId === null
                ? scopeLabel(null)
                : scopeLabel(departmentName)
            }
          />
        ))}
      </section>

      <RuleSetHistory
        title="تاریخچه قوانین و اعمال‌ها"
        entries={data.history}
        applications={data.applications}
        names={data.names}
        departmentName={(id) => (id === null ? null : departmentName)}
        scheduleLabel={(id) => labels.get(id) ?? "—"}
        versionName={name}
      />
    </div>
  );
}
