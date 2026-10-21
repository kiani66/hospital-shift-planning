"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import type {
  DailyPreferenceOperation,
  DailyPreferencePreview,
} from "@/application/schedules/daily-preferences";
import type { DatePeriod } from "@/domain/shared/period";
import type { Violation } from "@/domain/rules/violation";
import { toDiagnostic } from "@/domain/rules/diagnostic";
import type { IsoDate } from "@/domain/shared/dates";
import { Button } from "@/components/ui/button";
import { faNumber, formatJalaliDate } from "@/features/calendar/jalali";
import { staffingBoundsLabel } from "@/features/schedule-review/presentation";
import { FindingItem } from "@/features/schedule-review/finding-item";
import { ShiftChip } from "@/features/shifts/shift-chip";
import type { ShiftLabels } from "@/features/shifts/catalog";
import {
  acceptDailyPreferencesAction,
  readDailyPreferencesAction,
  type DailyAcceptResult,
} from "./actions";
import {
  dailyFailure,
  outcomeLabel,
  reasonLabel,
  statusLabel,
} from "./presentation";

type Props = {
  scheduleId: string;
  date: IsoDate;
  revision: number;
  period: DatePeriod;
  shiftLabels: ShiftLabels;
};
type Row = DailyPreferencePreview["groups"][number]["suggestions"][number];
const rejectionKey = (row: Row) => `${row.nurseId}:${row.preference}`;

/** Closing or changing day unmounts the session, including all local rejections. */
export function DailyPreferenceAssistant(props: Props) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <section
      className="mb-4 min-w-0 rounded-xl border bg-card p-3"
      aria-label="دستیار ترجیحات روزانه"
    >
      <Button
        ref={trigger}
        variant="secondary"
        className="w-full whitespace-normal"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
      >
        پیشنهاد بر اساس ترجیحات
      </Button>
      {open && (
        <div id={id}>
          <Session
            {...props}
            onClose={() => {
              setOpen(false);
              trigger.current?.focus();
            }}
          />
        </div>
      )}
    </section>
  );
}

function RuleFindings({
  violations,
  rows,
  period,
  shiftLabels,
}: {
  violations: readonly Violation[];
  rows: readonly Row[];
  period: DatePeriod;
  shiftLabels: ShiftLabels;
}) {
  if (!violations.length) return null;
  return (
    <ul className="space-y-2">
      {violations.map((v, i) => {
        const diagnostic = toDiagnostic(v, period);
        return (
          <li key={i}>
            <FindingItem
              finding={{
                ...diagnostic,
                nurses: diagnostic.nurseIds.map((userId) => ({
                  userId,
                  displayName:
                    rows.find((r) => r.nurseId === userId)?.displayName ??
                    "پرسنل",
                })),
              }}
              linked={false}
              shiftLabels={shiftLabels}
            />
          </li>
        );
      })}
    </ul>
  );
}

function Session({
  scheduleId,
  date,
  revision,
  period,
  shiftLabels,
  onClose,
}: Props & { onClose: () => void }) {
  const [preview, setPreview] = useState<DailyPreferencePreview | null>(null);
  const [rejected, setRejected] = useState<ReadonlySet<string>>(new Set());
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<
    Extract<DailyAcceptResult, { ok: true }>["data"] | null
  >(null);
  const [violations, setViolations] = useState<readonly Violation[]>([]);
  const [pending, startTransition] = useTransition();
  const busy = useRef(false);
  const active = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const descriptionId = useId();

  async function load() {
    const response = await readDailyPreferencesAction({ scheduleId, date });
    if (!active.current) return;
    if (response.ok) setPreview(response.data);
    else {
      setPreview(null);
      setMessage(response.message);
    }
  }
  function reload() {
    if (busy.current) return;
    busy.current = true;
    setMessage("");
    setViolations([]);
    setPreview(null);
    startTransition(async () => {
      try {
        await load();
      } catch {
        if (active.current)
          setMessage("دریافت پیشنهادها ممکن نشد. دوباره تلاش کنید.");
      } finally {
        busy.current = false;
      }
    });
  }
  useEffect(() => {
    active.current = true;
    heading.current?.focus();
    reload();
    return () => {
      active.current = false;
    };
    // One session per keyed schedule/date; revisions refresh reads below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (preview && preview.revision < revision && !pending && !busy.current)
      reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revision, preview, pending]);

  function accept(operation: DailyPreferenceOperation) {
    if (busy.current || !preview) return;
    busy.current = true;
    const snapshot = preview;
    setMessage("");
    setResult(null);
    setViolations([]);
    startTransition(async () => {
      try {
        const response = await acceptDailyPreferencesAction({
          scheduleId,
          date,
          expectedRevision: snapshot.revision,
          proof: snapshot.proof,
          operation,
        });
        if (!active.current) return;
        // Never reuse a proof after any write attempt, even an uncertain response.
        setPreview(null);
        if (response.ok) setResult(response.data);
        else {
          setMessage(response.message);
          setViolations(response.violations);
        }
        try {
          await load();
        } catch {
          if (active.current)
            setMessage(
              response.ok
                ? "تخصیص ثبت شد، اما دریافت فهرست تازه ممکن نشد. پیشنهادها را تازه‌سازی کنید."
                : "دریافت پیشنهادهای تازه ممکن نشد. دوباره تازه‌سازی کنید.",
            );
        }
      } catch {
        if (active.current) {
          setPreview(null);
          setMessage(dailyFailure({ code: "INTERNAL", message: "" }).message);
        }
      } finally {
        busy.current = false;
      }
    });
  }
  const rows = preview
    ? [
        ...preview.groups.flatMap((g) => g.suggestions),
        ...preview.offPreferences,
      ]
    : [];
  const excludedNurseIds = rows
    .filter((r) => rejected.has(rejectionKey(r)))
    .map((r) => r.nurseId);
  const canBulk =
    preview?.proposed.some((a) => !excludedNurseIds.includes(a.nurseId)) ??
    false;
  function renderRow(row: Row) {
    const excluded = rejected.has(rejectionKey(row));
    const explanation =
      row.status === "ALREADY_ASSIGNED"
        ? statusLabel.ALREADY_ASSIGNED
        : row.reason
          ? reasonLabel[row.reason]
          : statusLabel[row.status];
    return (
      <li
        key={row.nurseId}
        className="min-w-0 space-y-2 border-t py-3"
        aria-label={`پیشنهاد ${row.displayName ?? "پرسنل"}`}
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="min-w-0 flex-1 font-medium break-words">
            {row.displayName ?? "پرسنل"}
          </span>
          <ShiftChip code={row.preference} />
        </div>
        <p
          id={`${descriptionId}-${row.nurseId}`}
          className="text-sm text-muted-foreground"
        >
          {excluded
            ? "در این نوبت رد شده؛ با باز کردن دوباره دستیار بازمی‌گردد."
            : explanation}
        </p>
        {row.currentAssignment && (
          <p className="flex flex-wrap items-center gap-2 text-sm">
            تصمیم ثبت‌شده:{" "}
            <ShiftChip
              code={row.currentAssignment}
              label={shiftLabels[row.currentAssignment]}
            />
          </p>
        )}
        {row.assessment && (
          <RuleFindings
            violations={[
              ...row.assessment.blocking,
              ...row.assessment.warnings,
            ]}
            rows={rows}
            period={period}
            shiftLabels={shiftLabels}
          />
        )}
        {row.status !== "INFORMATIONAL" && (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={pending || excluded || row.status !== "ELIGIBLE"}
              aria-label={`تأیید پیشنهاد ${row.displayName ?? "پرسنل"}`}
              aria-describedby={`${descriptionId}-${row.nurseId}`}
              onClick={() => accept({ kind: "ONE", nurseId: row.nurseId })}
            >
              تأیید
            </Button>
            {row.status !== "ALREADY_ASSIGNED" && (
              <Button
                variant="ghost"
                disabled={pending || excluded}
                onClick={() =>
                  setRejected(new Set([...rejected, rejectionKey(row)]))
                }
              >
                رد پیشنهاد
              </Button>
            )}
          </div>
        )}
      </li>
    );
  }
  return (
    <div className="min-w-0 space-y-4 pt-4" aria-busy={pending}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3
          ref={heading}
          tabIndex={-1}
          className="rounded font-semibold focus-visible:ring-3 focus-visible:ring-ring"
        >
          ترجیحات {formatJalaliDate(date, { weekday: true })}
        </h3>
        <Button variant="ghost" onClick={onClose}>
          بستن دستیار
        </Button>
      </div>
      <div role="status" aria-live="polite" className="space-y-2 text-sm">
        {pending && <p>در حال بررسی…</p>}
        {message && <p>{message}</p>}
        {result && (
          <div className="rounded-lg border bg-secondary p-3">
            <p>
              {faNumber(result.createdAssignmentCount)} تخصیص ثبت شد؛{" "}
              {faNumber(result.alreadyAssignedCount)} مورد قبلاً تخصیص یافته؛{" "}
              {faNumber(result.skippedSuggestions.length)} پیشنهاد ثبت نشد.
            </p>
            {result.groupsRequiringManualSelection.length > 0 && (
              <p>
                گروه‌های{" "}
                {result.groupsRequiringManualSelection
                  .map((shift) => shiftLabels[shift])
                  .join("، ")}{" "}
                نیاز به انتخاب دستی دارند.
              </p>
            )}
            <details>
              <summary className="min-h-11 cursor-pointer py-3 focus-visible:ring-3 focus-visible:ring-ring">
                جزئیات نتیجه
              </summary>
              <ul className="space-y-2">
                {result.outcomes.map((o) => (
                  <li key={o.nurseId} className="break-words">
                    {o.displayName ?? "پرسنل"} · {o.preference} ·{" "}
                    {outcomeLabel[o.outcome]}
                    {o.reason && ` — ${reasonLabel[o.reason]}`}
                    <RuleFindings
                      violations={o.violations}
                      rows={rows}
                      period={period}
                      shiftLabels={shiftLabels}
                    />
                  </li>
                ))}
              </ul>
              {result.skippedGroups.map((g) => (
                <p key={g.shift}>
                  {g.shift}: {reasonLabel[g.reason]}
                </p>
              ))}
            </details>
          </div>
        )}
      </div>
      <RuleFindings
        violations={violations}
        rows={rows}
        period={period}
        shiftLabels={shiftLabels}
      />
      <Button variant="outline" disabled={pending} onClick={reload}>
        تازه‌سازی پیشنهادها
      </Button>
      {preview && (
        <>
          <div
            className="grid min-w-0 gap-2 sm:grid-cols-3"
            aria-label="پوشش فعلی پرستاری"
          >
            {preview.coverage.map((c) => (
              <div key={c.period} className="rounded-lg border p-3 text-sm">
                <ShiftChip code={c.period} label={shiftLabels[c.period]} />
                <p className="mt-2">پوشش فعلی: {faNumber(c.current)}</p>
                <p>
                  {staffingBoundsLabel({
                    min: c.minimum,
                    ...(c.maximum === null ? {} : { max: c.maximum }),
                  })}
                </p>
                <p>کمبود باقی‌مانده: {faNumber(c.currentShortage)}</p>
              </div>
            ))}
          </div>
          {!rows.length ? (
            <p className="rounded-lg border p-4">
              برای این روز ترجیحی ثبت نشده است.
            </p>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                شیفت ME در پوشش صبح و عصر هر کدام یک نفر محسوب می‌شود. پذیرش‌ها
                فوراً ثبت می‌شوند؛ تصمیم‌های قبلی حفظ می‌شوند.
              </p>
              <Button
                className="w-full whitespace-normal"
                disabled={pending || !canBulk}
                onClick={() => accept({ kind: "BULK", excludedNurseIds })}
              >
                تأیید همه پیشنهادهای مجاز
              </Button>
              {!canBulk && (
                <p className="text-sm text-muted-foreground">
                  پیشنهاد مجازی برای تأیید جمعی باقی نمانده است؛ گروه‌های
                  نیازمند انتخاب دستی را جداگانه بررسی کنید.
                </p>
              )}
              {preview.groups.map((g) => (
                <section
                  key={g.shift}
                  className="min-w-0 rounded-lg border p-3"
                  aria-label={`گروه ${g.shift}`}
                >
                  <h4 className="flex flex-wrap items-center gap-2 font-semibold">
                    <ShiftChip code={g.shift} label={shiftLabels[g.shift]} />
                    {faNumber(g.suggestions.length)} ترجیح
                  </h4>
                  {preview.skippedGroups
                    .filter(
                      (s) =>
                        s.shift === g.shift &&
                        (s.reason === "CAPACITY_CONTENTION" ||
                          s.reason === "BATCH_RULE_CONFLICT"),
                    )
                    .map((s) => (
                      <p key={s.reason} className="mt-2 text-sm">
                        {reasonLabel[s.reason]}{" "}
                        {s.contentionPeriods.length > 0 &&
                          `(${s.contentionPeriods.join(" / ")})`}
                      </p>
                    ))}
                  {g.suggestions.length ? (
                    <ul>{g.suggestions.map(renderRow)}</ul>
                  ) : (
                    <p className="py-2 text-sm text-muted-foreground">
                      ترجیحی در این گروه ثبت نشده است.
                    </p>
                  )}
                </section>
              ))}
              {preview.offPreferences.length > 0 && (
                <section
                  className="rounded-lg border p-3"
                  aria-label="ترجیحات استراحت"
                >
                  <h4 className="font-semibold">ترجیحات OFF — جهت اطلاع</h4>
                  <ul>{preview.offPreferences.map(renderRow)}</ul>
                </section>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
