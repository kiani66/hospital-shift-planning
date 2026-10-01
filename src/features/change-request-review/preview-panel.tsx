import { Ban, CircleCheck, Info, TriangleAlert } from "lucide-react";

import type { ChangePreviewView } from "@/application/schedules/change-preview";
import type { ReviewFinding } from "@/application/schedules/review";
import { Callout } from "@/components/ui/callout";
import { faNumber, formatJalaliDate } from "@/features/calendar/jalali";
import { CHANGE_MODE_LABELS } from "@/features/change-requests/presentation";
import {
  findingMessage,
  RULE_TITLES,
  staffingStatusLabel,
} from "@/features/schedule-review/presentation";
import { COVERAGE_PERIOD_NAMES } from "@/features/shifts/catalog";
import { ShiftChip } from "@/features/shifts/shift-chip";

function FindingList({
  title,
  findings,
}: {
  title: string;
  findings: readonly ReviewFinding[];
}) {
  return (
    <div className="flex flex-col gap-1">
      <p className="font-medium">{title}</p>
      <ul className="flex list-disc flex-col gap-1 ps-5">
        {findings.map((f, i) => (
          <li key={`${f.code}-${i}`}>
            <span className="font-medium">{RULE_TITLES[f.code]}: </span>
            {findingMessage(f)}
          </li>
        ))}
      </ul>
    </div>
  );
}

const Shift = ({ code }: { code: ReviewFinding["shift"] }) =>
  code ? (
    <ShiftChip code={code} size="xs" label />
  ) : (
    <span className="text-muted-foreground">بدون شیفت</span>
  );

/**
 * The validated outcome of a proposed change, against the schedule's
 * CURRENT working copy: where it goes (working copy or revision), each
 * changed cell before → after, hard findings (they block), warnings (they
 * do not), findings already there, and coverage per period with the
 * staffing status when bounds are configured.
 */
export function PreviewPanel({ preview }: { preview: ChangePreviewView }) {
  if (!preview.ok) return null;
  const configured = preview.staffing.some((d) =>
    d.periods.some((p) => p.bounds),
  );
  return (
    <section
      aria-label="نتیجه بررسی تغییر"
      className="flex flex-col gap-3 text-sm"
    >
      {preview.blocked ? (
        <Callout tone="attention" icon={Ban} as="div" role="status">
          <p className="font-semibold">
            این تغییر قابل اعمال نیست: قانون مسدودکننده نقض می‌شود.
          </p>
          <div className="mt-2">
            <FindingList
              title="مغایرت‌های مسدودکننده"
              findings={preview.blocking}
            />
          </div>
        </Callout>
      ) : (
        <Callout tone="success" icon={CircleCheck} role="status">
          مغایرت مسدودکننده‌ای در قوانین پیاده‌سازی‌شده پیدا نشد.
        </Callout>
      )}
      {preview.warnings.length > 0 && (
        <Callout tone="info" icon={TriangleAlert} as="div">
          <FindingList
            title="هشدار (مانع اعمال نیست)"
            findings={preview.warnings}
          />
        </Callout>
      )}
      {preview.persisting.length > 0 && (
        <Callout tone="muted" icon={Info} as="div">
          <FindingList
            title="مغایرت‌های موجود که بدتر نمی‌شوند"
            findings={preview.persisting}
          />
        </Callout>
      )}

      <div className="flex flex-col gap-1.5">
        <p className="font-medium">تغییرات</p>
        <ul className="flex flex-col gap-1.5">
          {preview.cells.map((c) => (
            <li
              key={`${c.nurseId}-${c.date}`}
              className="flex flex-wrap items-center gap-2"
            >
              <span className="font-medium">{c.displayName}</span>
              <span className="text-muted-foreground">
                {formatJalaliDate(c.date, { weekday: true })}:
              </span>
              <Shift code={c.before} />
              <span aria-hidden="true">←</span>
              <span className="sr-only">به</span>
              <Shift code={c.after} />
            </li>
          ))}
        </ul>
        <p className="text-muted-foreground">
          {CHANGE_MODE_LABELS[preview.mode]}
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <p className="font-medium">پوشش نوبت‌ها (قبل ← بعد)</p>
        {preview.staffing.map((day) => (
          <ul key={day.date} className="flex flex-wrap gap-x-4 gap-y-1">
            {day.periods.map((p) => (
              <li key={p.period}>
                {COVERAGE_PERIOD_NAMES[p.period]}: {faNumber(p.before)} ←{" "}
                {faNumber(p.after)}
                {p.bounds && (
                  <span className="text-muted-foreground">
                    {" "}
                    ({staffingStatusLabel(p.status, p.bounds)})
                  </span>
                )}
              </li>
            ))}
          </ul>
        ))}
        {!configured && (
          <p className="text-xs text-muted-foreground">
            حداقل و حداکثر نفرات تعریف نشده است؛ تأمین نفرات بررسی نمی‌شود.
          </p>
        )}
      </div>
    </section>
  );
}
