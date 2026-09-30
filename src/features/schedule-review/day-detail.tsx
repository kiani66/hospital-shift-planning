import { CircleAlert, Eye, Users } from "lucide-react";

import type {
  DayReview,
  ReviewNurse,
  ReviewShift,
} from "@/application/schedules/review";
import { faNumber } from "@/features/calendar/jalali";
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
      <span className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs text-muted-foreground">
        <Eye aria-hidden="true" className="size-3.5" />
        فقط مشاهده
      </span>
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
 * Layer 2: one day. Findings first (what needs attention), then the four
 * shifts with their nurses, then who has no shift. Read-only.
 */
export function DayDetail({ day }: { day: DayReview }) {
  return (
    <div className="flex flex-col gap-4">
      <Findings day={day} />
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
