"use client";

import { Copy } from "lucide-react";
import { useRef, useState, useTransition } from "react";
import type { ScheduleCopyPreview } from "@/application/schedules/copy";
import type { ScheduleListItem } from "@/application/schedules/queries";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import type { CopyScope } from "@/domain/schedule/copy";
import type { IsoDate } from "@/domain/shared/dates";
import { periodDays } from "@/domain/shared/period";
import {
  faNumber,
  formatJalaliDate,
  formatJalaliRange,
} from "@/features/calendar/jalali";
import type { ShiftLabels } from "@/features/shifts/catalog";
import {
  applyCopyAction,
  getCopySourceAction,
  previewCopyAction,
} from "./actions";
import { copyErrorMessage } from "./presentation";
import { CopyPreviewPanel } from "./preview-panel";

const field =
  "min-h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm";

export function ScheduleCopyDialog({
  target,
  sources,
  shiftLabels,
}: {
  target: ScheduleListItem;
  sources: readonly ScheduleListItem[];
  shiftLabels: ShiftLabels;
}) {
  const suggested =
    sources
      .filter((s) => s.period.end < target.period.start)
      .toSorted((a, b) => b.period.start.localeCompare(a.period.start))[0] ??
    target;
  const [open, setOpen] = useState(false);
  const [sourceId, setSourceId] = useState(suggested.id);
  const source = sources.find((s) => s.id === sourceId)!;
  const [mode, setMode] = useState<CopyScope["mode"]>("MONTH");
  const [sourceStart, setSourceStart] = useState(source.period.start);
  const [sourceEnd, setSourceEnd] = useState(source.period.start);
  const [targetStart, setTargetStart] = useState(target.period.start);
  const [roster, setRoster] = useState<ScheduleCopyPreview["nurses"]>([]);
  const [selectedOnly, setSelectedOnly] = useState(false);
  const [nurseIds, setNurseIds] = useState<string[]>([]);
  const [preview, setPreview] = useState<ScheduleCopyPreview | null>(null);
  const [message, setMessage] = useState("");
  const [success, setSuccess] = useState("");
  const [pending, startTransition] = useTransition();
  const inFlight = useRef(false);
  const scope: CopyScope =
    mode === "MONTH"
      ? { mode }
      : mode === "DAY"
        ? { mode, sourceDate: sourceStart, targetDate: targetStart }
        : { mode, sourceStart, sourceEnd, targetStart };
  const resetPreview = () => {
    setPreview(null);
    setMessage("");
  };
  function loadSource(id: string) {
    const next = sources.find((s) => s.id === id)!;
    setSourceId(id);
    setSourceStart(next.period.start);
    setSourceEnd(next.period.start);
    setNurseIds([]);
    setSelectedOnly(false);
    setRoster([]);
    resetPreview();
    startTransition(async () => {
      try {
        const result = await getCopySourceAction({
          sourceScheduleId: id,
          targetScheduleId: target.id,
          scope: { mode: "MONTH" },
        });
        if (result.ok) setRoster(result.data);
        else setMessage(copyErrorMessage(result.error));
      } catch {
        setMessage("دریافت فهرست مبدأ ممکن نشد؛ دوباره تلاش کنید.");
      }
    });
  }
  function runPreview() {
    if (pending || inFlight.current) return;
    resetPreview();
    startTransition(async () => {
      try {
        const result = await previewCopyAction({
          sourceScheduleId: sourceId,
          targetScheduleId: target.id,
          scope,
          selection: selectedOnly ? { nurseIds } : {},
        });
        if (result.ok) setPreview(result.data);
        else setMessage(copyErrorMessage(result.error));
      } catch {
        setMessage("دریافت پیش‌نمایش ممکن نشد؛ دوباره تلاش کنید.");
      }
    });
  }
  function apply() {
    if (!preview?.canApply || pending || inFlight.current) return;
    inFlight.current = true;
    startTransition(async () => {
      try {
        const reviewed = preview;
        const result = await applyCopyAction(reviewed.payload);
        setPreview(null);
        if (result.ok) {
          const leaveCount = reviewed.rows.filter(
            (row) => row.reason === "SOURCE_LEAVE_NOT_COPIED",
          ).length;
          const conflictCount = reviewed.conflictCount;
          const otherSkippedCount = reviewed.skippedCount - leaveCount;
          setSuccess(
            `${faNumber(result.data.assignmentCount)} انتساب کپی شد. ${faNumber(result.data.excludedCount)} مورد منتقل نشد. ${faNumber(leaveCount)} مرخصی مبدأ کپی نشد؛ ${faNumber(conflictCount)} تداخل و ${faNumber(otherSkippedCount)} مورد دیگر منتقل نشد.${result.data.correctableViolations.length ? ` ${faNumber(result.data.correctableViolations.length)} مغایرت نیازمند اصلاح است.` : ""} کپی به معنی آمادگی برنامه برای نهایی‌سازی نیست.`,
          );
          setOpen(false);
        } else setMessage(copyErrorMessage(result.error));
      } catch {
        setPreview(null);
        setMessage("پاسخ ثبت دریافت نشد؛ پیش از تلاش دوباره پیش‌نمایش بگیرید.");
      } finally {
        inFlight.current = false;
      }
    });
  }
  const dateOptions = (dates: IsoDate[]) =>
    dates.map((date) => (
      <option key={date} value={date}>
        {formatJalaliDate(date)}
      </option>
    ));
  return (
    <>
      <Button
        variant="outline"
        onClick={() => {
          setSuccess("");
          setMessage("");
          setPreview(null);
          setOpen(true);
          loadSource(sourceId);
        }}
      >
        <Copy aria-hidden="true" className="size-5" />
        کپی برنامه
      </Button>
      {success && (
        <p role="status" className="text-sm">
          {success}
        </p>
      )}
      <Dialog
        open={open}
        onClose={() => {
          if (!pending) {
            setOpen(false);
            setPreview(null);
          }
        }}
        title="کپی برنامه"
        description="انتساب‌های مبدأ پس از نگاشت با شرایط مقصد بررسی می‌شوند. تصمیم‌های قبلی مقصد و ترجیحات حفظ می‌شوند؛ مرخصی مبدأ کپی نمی‌شود."
        closeLabel="بستن کپی برنامه"
        preventClose={pending}
        stickyHeader
        focusTitle
        className="max-h-[90dvh] overflow-y-auto sm:w-[min(calc(100vw-2rem),48rem)]"
      >
        <p className="text-sm font-semibold">
          مقصد: {target.label} ·{" "}
          {formatJalaliRange(target.period.start, target.period.end)}
        </p>
        <details open={!preview}>
          <summary className="min-h-11 cursor-pointer text-sm font-semibold">
            {preview ? "تغییر مبدأ یا محدوده کپی" : "انتخاب مبدأ و محدوده کپی"}
          </summary>
          <fieldset disabled={pending} className="flex min-w-0 flex-col gap-4">
            <label className="flex flex-col gap-1 text-sm">
              برنامه مبدأ
              <select
                className={field}
                value={sourceId}
                onChange={(e) => loadSource(e.target.value)}
              >
                {sources.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label} ·{" "}
                    {formatJalaliRange(s.period.start, s.period.end)}
                    {s.id === target.id ? " (همین برنامه)" : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              نوع کپی
              <select
                className={field}
                value={mode}
                onChange={(e) => {
                  setMode(e.target.value as CopyScope["mode"]);
                  resetPreview();
                }}
              >
                <option value="MONTH">کل ماه</option>
                <option value="DAY">یک روز</option>
                <option value="RANGE">بازه روزها</option>
              </select>
            </label>
            {mode !== "MONTH" && (
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="flex flex-col gap-1 text-sm">
                  {mode === "DAY" ? "روز مبدأ" : "شروع مبدأ"}
                  <select
                    className={field}
                    value={sourceStart}
                    onChange={(e) => {
                      setSourceStart(e.target.value as IsoDate);
                      resetPreview();
                    }}
                  >
                    {dateOptions(periodDays(source.period))}
                  </select>
                </label>
                {mode === "RANGE" && (
                  <label className="flex flex-col gap-1 text-sm">
                    پایان مبدأ
                    <select
                      className={field}
                      value={sourceEnd}
                      onChange={(e) => {
                        setSourceEnd(e.target.value as IsoDate);
                        resetPreview();
                      }}
                    >
                      {dateOptions(periodDays(source.period))}
                    </select>
                  </label>
                )}
                <label className="flex flex-col gap-1 text-sm">
                  {mode === "DAY" ? "روز مقصد" : "شروع مقصد"}
                  <select
                    className={field}
                    value={targetStart}
                    onChange={(e) => {
                      setTargetStart(e.target.value as IsoDate);
                      resetPreview();
                    }}
                  >
                    {dateOptions(periodDays(target.period))}
                  </select>
                </label>
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              {mode === "MONTH"
                ? "نگاشت بر اساس شماره روز ماه است؛ روزهای اضافی منتقل نمی‌شوند."
                : "نگاشت روزها ترتیبی است؛ روزهای خارج از دوره مقصد منتقل نمی‌شوند."}
            </p>
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={selectedOnly}
                onChange={(e) => {
                  setSelectedOnly(e.target.checked);
                  resetPreview();
                }}
              />
              فقط پرسنل انتخاب‌شده
            </label>
            {selectedOnly && (
              <fieldset className="rounded-md border p-2">
                <legend className="px-1 text-sm">پرسنل مبدأ</legend>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2 border-b pb-2 text-sm">
                  <span>
                    {faNumber(nurseIds.length)} نفر از {faNumber(roster.length)} نفر
                    انتخاب شده‌اند
                  </span>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={
                        pending ||
                        roster.length === 0 ||
                        nurseIds.length === roster.length
                      }
                      onClick={() => {
                        setNurseIds(roster.map((n) => n.userId));
                        resetPreview();
                      }}
                    >
                      انتخاب همه
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={pending || nurseIds.length === 0}
                      onClick={() => {
                        setNurseIds([]);
                        resetPreview();
                      }}
                    >
                      لغو انتخاب همه
                    </Button>
                  </div>
                </div>
                <div className="grid max-h-48 gap-1 overflow-y-auto sm:grid-cols-2">
                  {roster.map((n) => (
                    <label
                    key={n.userId}
                    className="flex min-h-11 items-center gap-2 text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={nurseIds.includes(n.userId)}
                      onChange={(e) => {
                        setNurseIds((ids) =>
                          e.target.checked
                            ? [...ids, n.userId]
                            : ids.filter((id) => id !== n.userId),
                        );
                        resetPreview();
                      }}
                    />
                    {n.displayName}
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
            <Button
              onClick={runPreview}
              disabled={pending || (selectedOnly && !nurseIds.length)}
              variant="secondary"
            >
              {pending ? "در حال بررسی…" : "پیش‌نمایش کپی"}
            </Button>
          </fieldset>
        </details>
        {message && (
          <p role="alert" className="text-sm text-destructive">
            {message}
          </p>
        )}
        {preview && (
          <CopyPreviewPanel
            preview={preview}
            period={target.period}
            shiftLabels={shiftLabels}
            pending={pending}
            onApply={apply}
          />
        )}
        <Button
          variant="outline"
          disabled={pending}
          onClick={() => {
            setOpen(false);
            setPreview(null);
          }}
        >
          انصراف
        </Button>
      </Dialog>
    </>
  );
}
