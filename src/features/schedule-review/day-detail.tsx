import { CircleAlert, Eye, Link2, Lock, Pencil, Users } from "lucide-react";
import type { ReactNode } from "react";

import type {
  DayReview,
  ReviewNurse,
  ReviewShift,
} from "@/application/schedules/review";
import { faNumber } from "@/features/calendar/jalali";
import { editDenialLabel } from "@/features/schedule-editing/presentation";
import { ROLE_LABELS } from "@/features/schedule/labels";
import {
  COVERAGE_PERIOD_NAMES,
  SHIFT_PRESENTATION,
  shiftHoursLabel,
} from "@/features/shifts/catalog";
import { cn } from "@/lib/utils";

import { HealthIcon } from "./health-icon";
import { NurseAvatar } from "./nurse-avatar";
import {
  HEALTH_PRESENTATION,
  HOLIDAY_LABEL,
  RULE_TITLES,
  findingMessage,
  findingSeverityLabel,
  preferenceLabel,
  staffingStatusLabel,
} from "./presentation";

/** The day's health and holiday as two independent badges (icon + text). */
export function DayBadges({ day }: { day: DayReview }) {
  return (
    <span className="flex flex-wrap items-center gap-2">
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium",
          HEALTH_PRESENTATION[day.health].badgeClass,
        )}
      >
        <HealthIcon health={day.health} />
        {HEALTH_PRESENTATION[day.health].label}
      </span>
      {day.holiday && (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-holiday/40 bg-holiday/10 px-2.5 py-1 text-xs font-medium text-holiday-foreground">
          {HOLIDAY_LABEL}: {day.holiday.name}
        </span>
      )}
      {day.edit.allowed ? (
        <span className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs text-muted-foreground">
          <Pencil aria-hidden="true" className="size-3.5" />
          قابل ویرایش
        </span>
      ) : (
        <span className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs text-muted-foreground">
          <Eye aria-hidden="true" className="size-3.5" />
          فقط مشاهده
        </span>
      )}
    </span>
  );
}

function NurseRow({ nurse }: { nurse: ReviewNurse }) {
  return (
    <li className="flex min-w-0 items-center gap-2 py-1.5">
      <NurseAvatar displayName={nurse.displayName} />
      <span className="min-w-0 flex-1 truncate text-sm">
        {nurse.displayName}
      </span>
      {nurse.role === "HEAD_NURSE" && (
        <span className="shrink-0 text-xs text-muted-foreground">
          {ROLE_LABELS.HEAD_NURSE}
        </span>
      )}
      {nurse.preference && (
        <span className="shrink-0 rounded border px-1.5 text-xs text-muted-foreground">
          {preferenceLabel(nurse.preference)}
        </span>
      )}
    </li>
  );
}

function Findings({ day }: { day: DayReview }) {
  return (
    <section
      aria-labelledby="day-findings"
      className="flex flex-col gap-3 rounded-lg border p-4"
    >
      <h3 id="day-findings" className="flex items-center gap-2 font-semibold">
        <CircleAlert
          aria-hidden="true"
          className="size-5 text-health-attention-foreground"
        />
        نیاز به بررسی
        <span className="text-sm font-normal text-muted-foreground">
          (
          {day.findings.length > 0
            ? `${faNumber(day.findings.length)} مورد`
            : "بدون مورد"}
          )
        </span>
      </h3>
      {day.findings.length === 0 ? (
        <p className="text-sm leading-relaxed text-muted-foreground">
          {HEALTH_PRESENTATION[day.health].description}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {day.findings.map((f, i) => (
            <li
              key={`${f.code}-${f.nurseIds.join()}-${i}`}
              className="flex flex-col gap-1 rounded-md border border-s-4 border-health-attention/40 border-s-health-attention bg-health-attention/5 p-3"
            >
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-semibold">
                {RULE_TITLES[f.code]}
                <span className="rounded bg-health-attention/15 px-1.5 text-xs font-medium text-health-attention-foreground">
                  {findingSeverityLabel(f)}
                </span>
              </span>
              <p className="text-sm leading-relaxed">{findingMessage(f)}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * Findings reported on the neighbouring day that involve this one (the
 * Night before a violating shift), so either day explains the conflict.
 */
function RelatedFindings({ day }: { day: DayReview }) {
  if (day.relatedFindings.length === 0) return null;
  return (
    <section
      aria-labelledby="day-related-findings"
      className="flex flex-col gap-2 rounded-lg border border-dashed p-3"
    >
      <h3
        id="day-related-findings"
        className="flex items-center gap-2 text-sm font-semibold"
      >
        <Link2 aria-hidden="true" className="size-4 text-muted-foreground" />
        مرتبط با روز دیگر ({faNumber(day.relatedFindings.length)} مورد)
      </h3>
      <ul className="flex flex-col gap-1.5">
        {day.relatedFindings.map((f, i) => (
          <li
            key={`${f.code}-${f.nurseIds.join()}-${i}`}
            className="text-sm leading-relaxed"
          >
            <span className="font-medium">{RULE_TITLES[f.code]}: </span>
            {findingMessage(f)}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** One line per coverage period while editing: how many staff it has (ME included). */
function CoverageSummary({ day }: { day: DayReview }) {
  const status = day.coverage[0]!;
  const sameStatus = day.coverage.every((c) => c.status === status.status);
  return (
    <section
      aria-label="پوشش نفرات در این روز"
      className="flex flex-col gap-1 rounded-lg border px-3 py-2 text-xs leading-relaxed text-muted-foreground"
    >
      <p className="flex flex-wrap gap-x-4 gap-y-1">
        {day.coverage.map((c) => {
          const direct = day.shifts.find((s) => s.code === c.period)!.nurses
            .length;
          const fromLong = c.covered - direct;
          return (
            <span key={c.period}>
              پوشش {COVERAGE_PERIOD_NAMES[c.period]}:{" "}
              <span className="font-semibold text-foreground">
                {faNumber(c.covered)} نفر
              </span>
              {fromLong > 0 && ` (${faNumber(fromLong)} نفر از شیفت طولانی)`}
              {!sameStatus && ` · ${staffingStatusLabel(c.status, c.bounds)}`}
            </span>
          );
        })}
      </p>
      {sameStatus && <p>{staffingStatusLabel(status.status, status.bounds)}</p>}
    </section>
  );
}

/** Operational coverage of M/E (including long shifts) and its staffing status. */
function CoverageNote({ day, shift }: { day: DayReview; shift: ReviewShift }) {
  if (shift.code === "ME")
    return (
      <p className="text-xs leading-relaxed text-muted-foreground">
        در پوشش صبح و عصر هر دو شمرده می‌شود.
      </p>
    );
  const coverage = day.coverage.find((c) => c.period === shift.code)!;
  const fromLong = coverage.covered - shift.nurses.length;
  return (
    <p className="text-xs leading-relaxed text-muted-foreground">
      پوشش {COVERAGE_PERIOD_NAMES[coverage.period]}:{" "}
      <span className="font-semibold text-foreground">
        {faNumber(coverage.covered)} نفر
      </span>
      {fromLong > 0 && ` (${faNumber(fromLong)} نفر از شیفت طولانی)`} ·{" "}
      {staffingStatusLabel(coverage.status, coverage.bounds)}
    </p>
  );
}

function ShiftSection({ day, shift }: { day: DayReview; shift: ReviewShift }) {
  const p = SHIFT_PRESENTATION[shift.code];
  const id = `shift-${shift.code}`;
  return (
    <section
      aria-labelledby={id}
      className="flex min-w-0 flex-col gap-2 rounded-lg border p-3"
    >
      <h3 id={id} className="flex items-center gap-2">
        <span
          dir="ltr"
          className={cn(
            "inline-flex min-w-9 justify-center rounded px-1.5 py-0.5 text-sm font-bold",
            p.tokenClass,
          )}
        >
          {shift.code}
        </span>
        <span className="font-semibold">{p.fullName}</span>
        <span className="ms-auto text-sm font-semibold whitespace-nowrap">
          {faNumber(shift.nurses.length)} نفر
        </span>
      </h3>
      <p className="text-xs text-muted-foreground">
        {shiftHoursLabel(shift.code)}
      </p>
      <CoverageNote day={day} shift={shift} />
      {shift.nurses.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          کسی برای این شیفت ثبت نشده است.
        </p>
      ) : (
        <ul aria-label={`پرستاران شیفت ${p.name}`} className="divide-y">
          {shift.nurses.map((n) => (
            <NurseRow key={n.userId} nurse={n} />
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * Layer 2: one day. Findings first (what needs attention). With `editor`
 * (the Head Nurse may edit this day), the coverage and the editing list of
 * every rostered nurse follow; otherwise the four shifts with their nurses,
 * then who has no shift, read-only with the reason.
 */
export function DayDetail({
  day,
  editor,
}: {
  day: DayReview;
  editor?: ReactNode;
}) {
  if (editor)
    return (
      <div className="flex flex-col gap-4">
        <Findings day={day} />
        <RelatedFindings day={day} />
        <CoverageSummary day={day} />
        {editor}
      </div>
    );
  return (
    <div className="flex flex-col gap-4">
      {!day.edit.allowed && (
        <p className="flex items-start gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          <Lock aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {editDenialLabel(day.edit.reason)}
        </p>
      )}
      <Findings day={day} />
      <RelatedFindings day={day} />
      <div className="grid gap-3 md:grid-cols-2">
        {day.shifts.map((shift) => (
          <ShiftSection key={shift.code} day={day} shift={shift} />
        ))}
      </div>
      <details className="rounded-lg border">
        <summary className="flex min-h-11 cursor-pointer items-center gap-2 px-3 text-sm font-medium focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-none">
          <Users aria-hidden="true" className="size-4 text-muted-foreground" />
          بدون شیفت در این روز ({faNumber(day.unassigned.length)} نفر)
        </summary>
        {day.unassigned.length === 0 ? (
          <p className="border-t px-3 py-2 text-sm text-muted-foreground">
            همه پرسنل برنامه در این روز شیفت دارند.
          </p>
        ) : (
          <ul className="divide-y border-t px-3">
            {day.unassigned.map((n) => (
              <NurseRow key={n.userId} nurse={n} />
            ))}
          </ul>
        )}
      </details>
    </div>
  );
}
