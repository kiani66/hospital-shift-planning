"use client";

import { Search, Wrench } from "lucide-react";
import { useActionState, useId, useState } from "react";

import type { ReasonView } from "@/application/change-requests/queries";
import { Button } from "@/components/ui/button";
import { CHANGE_NOTE_MAX_LENGTH } from "@/domain/change-requests/reason";
import type { IsoDate } from "@/domain/shared/dates";
import { SHIFT_CODES, type ShiftCode } from "@/domain/shifts/shift-type";
import type { RequestFormState } from "@/features/change-requests/actions";
import { requestErrorMessage } from "@/features/change-requests/presentation";
import { SHIFT_PRESENTATION } from "@/features/shifts/catalog";

import {
  adjustScheduleAction,
  previewAdjustmentAction,
  type AdjustmentPreviewState,
} from "./actions";
import { PreviewPanel } from "./preview-panel";

const FIELD_CLASS =
  "min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-none";

const shiftLabel = (code: ShiftCode | null) =>
  code ? `${SHIFT_PRESENTATION[code].name} (${code})` : "بدون شیفت";

/**
 * A Head Nurse's direct operational adjustment of one nurse's shift on this
 * day, offered where the planning editor cannot act (an approved schedule,
 * or a day outside the open revision). Two steps: "check" validates against
 * the current schedule without writing (where it goes, hard findings,
 * warnings, coverage); "apply" needs a structured reason (and a note for
 * "Other") and is validated and audited again on the server.
 */
export function AdjustmentForm({
  scheduleId,
  revision,
  date,
  nurses,
  reasons,
}: {
  scheduleId: string;
  revision: number;
  date: IsoDate;
  nurses: readonly {
    readonly userId: string;
    readonly displayName: string;
    readonly shift: ShiftCode | null;
  }[];
  reasons: readonly ReasonView[];
}) {
  const ids = {
    nurse: useId(),
    shift: useId(),
    reason: useId(),
    note: useId(),
  };
  const [nurseId, setNurseId] = useState("");
  const [shift, setShift] = useState<ShiftCode | "" | "NONE">("");
  const [reasonCode, setReasonCode] = useState("");
  const [note, setNote] = useState("");
  // A preview belongs to the selection it was made for.
  const [checkedFor, setCheckedFor] = useState("");
  const selection = `${nurseId}|${shift}`;

  const [preview, previewAction, checking] = useActionState(
    async (previous: AdjustmentPreviewState, formData: FormData) => {
      const next = await previewAdjustmentAction(previous, formData);
      setCheckedFor(selection);
      return next;
    },
    { status: "idle" },
  );
  const [result, applyAction, applying] = useActionState(
    async (previous: RequestFormState, formData: FormData) => {
      const next = await adjustScheduleAction(previous, formData);
      if (next.status === "success") {
        setNurseId("");
        setShift("");
        setReasonCode("");
        setNote("");
        setCheckedFor("");
      }
      return next;
    },
    { status: "idle" },
  );

  const current = nurses.find((n) => n.userId === nurseId);
  const fresh = checkedFor === selection && preview.status === "ready";
  const canApply =
    fresh &&
    preview.status === "ready" &&
    preview.preview.ok &&
    !preview.preview.blocked;
  const reason = reasons.find((r) => r.code === reasonCode);

  return (
    <section
      aria-labelledby={`${ids.nurse}-title`}
      className="flex flex-col gap-3 rounded-xl border bg-card p-4 shadow-xs"
    >
      <h3
        id={`${ids.nurse}-title`}
        className="flex items-center gap-2 font-semibold"
      >
        <Wrench aria-hidden="true" className="size-4 text-primary" />
        تغییر عملیاتی
      </h3>
      <p className="text-sm leading-relaxed text-muted-foreground">
        برای نیاز عملیاتی، بدون درخواست پرستار. با علت ثبت می‌شود، بررسی می‌شود
        و نسخه تأییدشده را مستقیم تغییر نمی‌دهد.
      </p>
      <form className="flex flex-col gap-3">
        <input type="hidden" name="scheduleId" value={scheduleId} />
        <input type="hidden" name="expectedRevision" value={revision} />
        <input type="hidden" name="date" value={date} />
        <div className="flex flex-col gap-1.5">
          <label htmlFor={ids.nurse} className="text-sm font-medium">
            پرستار
          </label>
          <select
            id={ids.nurse}
            name="nurseId"
            value={nurseId}
            onChange={(e) => setNurseId(e.target.value)}
            className={FIELD_CLASS}
          >
            <option value="" disabled>
              انتخاب پرستار
            </option>
            {nurses.map((n) => (
              <option key={n.userId} value={n.userId}>
                {n.displayName} — {shiftLabel(n.shift)}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={ids.shift} className="text-sm font-medium">
            شیفت جدید
          </label>
          <select
            id={ids.shift}
            value={shift}
            onChange={(e) => setShift(e.target.value as ShiftCode | "NONE")}
            className={FIELD_CLASS}
          >
            <option value="" disabled>
              انتخاب شیفت
            </option>
            {SHIFT_CODES.filter((c) => c !== current?.shift).map((code) => (
              <option key={code} value={code}>
                {shiftLabel(code)}
              </option>
            ))}
            {current?.shift !== null && <option value="NONE">بدون شیفت</option>}
          </select>
          {/* The server reads "" as "no shift". */}
          <input
            type="hidden"
            name="shift"
            value={shift === "NONE" ? "" : shift}
          />
        </div>
        <Button
          type="submit"
          variant="secondary"
          formAction={previewAction}
          disabled={!nurseId || !shift || checking}
          className="self-start"
        >
          <Search aria-hidden="true" className="size-4" />
          {checking ? "در حال بررسی…" : "بررسی تغییر"}
        </Button>

        {fresh &&
          preview.status === "ready" &&
          (preview.preview.ok ? (
            <PreviewPanel preview={preview.preview} />
          ) : (
            <p role="alert" className="text-sm text-destructive">
              {requestErrorMessage("adjust", preview.preview.error)}
            </p>
          ))}
        {preview.status === "error" && (
          <p role="alert" className="text-sm text-destructive">
            {preview.message}
          </p>
        )}

        {canApply && (
          <>
            <div className="flex flex-col gap-1.5">
              <label htmlFor={ids.reason} className="text-sm font-medium">
                علت تغییر
              </label>
              <select
                id={ids.reason}
                name="reasonCode"
                value={reasonCode}
                onChange={(e) => setReasonCode(e.target.value)}
                className={FIELD_CLASS}
              >
                <option value="" disabled>
                  انتخاب علت
                </option>
                {reasons.map((r) => (
                  <option key={r.code} value={r.code}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor={ids.note} className="text-sm font-medium">
                توضیح{reason?.requiresNote ? " (الزامی)" : " (اختیاری)"}
              </label>
              <textarea
                id={ids.note}
                name="note"
                rows={2}
                dir="auto"
                maxLength={CHANGE_NOTE_MAX_LENGTH}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className={`${FIELD_CLASS} leading-relaxed`}
              />
            </div>
            <Button
              type="submit"
              formAction={applyAction}
              disabled={!reasonCode || applying}
              className="self-start"
            >
              {applying ? "در حال ثبت…" : "اعمال تغییر"}
            </Button>
          </>
        )}
        <p
          role={result.status === "error" ? "alert" : "status"}
          className={
            result.status === "error"
              ? "text-sm text-destructive"
              : result.status === "success"
                ? "text-sm text-muted-foreground"
                : "sr-only"
          }
        >
          {result.status === "error"
            ? [result.message, ...Object.values(result.fields ?? {})].join(" ")
            : result.status === "success"
              ? result.message
              : null}
        </p>
      </form>
    </section>
  );
}
