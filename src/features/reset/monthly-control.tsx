"use client";
import { useState, useTransition } from "react";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { faNumber } from "@/features/calendar/jalali";
import { SCHEDULE_STATUS_LABELS } from "@/features/schedule/labels";
import {
  previewMonthlyResetAction,
  resetMonthlyPlanningAction,
} from "./monthly-actions";
type Preview = Extract<
  Awaited<ReturnType<typeof previewMonthlyResetAction>>,
  { ok: true }
>["data"];
export function MonthlyResetControl({ scheduleId }: { scheduleId: string }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [pending, start] = useTransition();
  return (
    <>
      <Button
        variant="outline"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            setSuccess(false);
            const result = await previewMonthlyResetAction(scheduleId);
            if (result.ok) setPreview(result.data);
            else
              setError(
                "بازنشانی در دسترس نیست؛ وضعیت و دسترسی برنامه را بررسی کنید.",
              );
          })
        }
      >
        <RotateCcw aria-hidden="true" />
        بازنشانی چیدمان
      </Button>
      {success && (
        <p role="status">چیدمان پاک شد؛ ترجیحات و برنامه باقی ماندند.</p>
      )}
      {error && !preview && <p role="alert">{error}</p>}
      <Dialog
        preventClose={pending}
        open={preview !== null}
        onClose={() => {
          if (!pending) setPreview(null);
        }}
        title="بازنشانی چیدمان ماه؟"
        description="همه شیفت‌ها و تغییرات چیدمان پاک می‌شوند. این کار قابل بازگردانی نیست."
      >
        {preview && (
          <div className="flex flex-col gap-4">
            <p>
              {preview.department} · {preview.month} ·{" "}
              {SCHEDULE_STATUS_LABELS[preview.status]}
            </p>
            <p>
              {faNumber(preview.counts.assignments)} شیفت،{" "}
              {faNumber(preview.counts.changes)} تغییر و{" "}
              {faNumber(preview.counts.changeCells)} سلول وابسته حذف می‌شود.
            </p>
            <p>
              {faNumber(preview.counts.preferences)} ترجیح پرستاران باقی
              می‌ماند. برنامه، شناسه، فهرست پرسنل، پنجره‌های ترجیحات و قوانین
              تغییر نمی‌کنند.
            </p>
            {error && <p role="alert">{error}</p>}
            <div className="flex gap-2">
              <Button
                variant="outline"
                autoFocus
                disabled={pending}
                onClick={() => setPreview(null)}
              >
                انصراف
              </Button>
              <Button
                variant="destructive"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const result = await resetMonthlyPlanningAction({
                      scheduleId: preview.scheduleId,
                      expectedRevision: preview.revision,
                    });
                    if (result.ok) {
                      setPreview(null);
                      setSuccess(true);
                    } else {
                      setError(
                        result.error.code === "CONFLICT"
                          ? "برنامه تغییر کرده است؛ پیش‌نمایش تازه بگیرید."
                          : "بازنشانی انجام نشد؛ وضعیت و دسترسی برنامه را بررسی کنید.",
                      );
                    }
                  })
                }
              >
                {pending ? "در حال انجام…" : "پاک کردن چیدمان"}
              </Button>
            </div>
          </div>
        )}
      </Dialog>
    </>
  );
}
