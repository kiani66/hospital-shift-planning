"use client";

import { FilePlus2 } from "lucide-react";
import { useActionState, useId, useState } from "react";

import type {
  ReasonView,
  SwapCandidate,
} from "@/application/change-requests/queries";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import {
  CHANGE_REQUEST_TYPES,
  type ChangeRequestType,
} from "@/domain/change-requests/model";
import { CHANGE_NOTE_MAX_LENGTH } from "@/domain/change-requests/reason";
import type { IsoDate } from "@/domain/shared/dates";
import {
  SHIFT_CODES,
  isWorkingShift,
  type AssignmentCode,
  type ShiftCode,
} from "@/domain/shifts/shift-type";
import { faNumber } from "@/features/calendar/jalali";
import type { ShiftLabels } from "@/features/shifts/catalog";
import { ShiftChip } from "@/features/shifts/shift-chip";
import { cn } from "@/lib/utils";

import { createChangeRequestAction, type RequestFormState } from "./actions";
import {
  REQUEST_TYPE_DESCRIPTIONS,
  REQUEST_TYPE_LABELS,
  decisionPhrase,
} from "./presentation";

const FIELD_CLASS =
  "min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-none aria-invalid:border-destructive";

/** A field's error, linked to it by id. */
function FieldError({ id, message }: { id: string; message?: string }) {
  return message ? (
    <p id={id} className="text-sm leading-relaxed text-destructive">
      {message}
    </p>
  ) : null;
}

/**
 * Asking for a change to one of the nurse's own assignments. The day and its
 * shift are fixed by the row the dialog was opened from; the nurse picks the
 * type, the type's details (the shift asked for, the colleague to swap with),
 * a structured reason and a note (required for "Other"). The server checks
 * everything again; its field errors are shown next to their fields.
 */
export function NewRequestDialog({
  scheduleId,
  date,
  dateLabel,
  shift,
  reasons,
  swapCandidates,
  shiftLabels,
}: {
  scheduleId: string;
  date: IsoDate;
  dateLabel: string;
  shift: AssignmentCode;
  reasons: readonly ReasonView[];
  swapCandidates: readonly SwapCandidate[];
  /** Descriptive shift names (`shift_types.label`). */
  shiftLabels: ShiftLabels;
}) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<ChangeRequestType>(
    isWorkingShift(shift) ? "UNAVAILABLE" : "SWAP",
  );
  // Every field is controlled: React resets uncontrolled fields after a form
  // action, which would lose the nurse's choices when the server refuses.
  const [targetShift, setTargetShift] = useState<ShiftCode | "">("");
  const [counterpartId, setCounterpartId] = useState("");
  const [reasonCode, setReasonCode] = useState("");
  const [note, setNote] = useState("");
  const ids = {
    form: useId(),
    target: useId(),
    counterpart: useId(),
    reason: useId(),
    note: useId(),
    noteHint: useId(),
  };
  const [state, formAction, pending] = useActionState(
    async (previous: RequestFormState, formData: FormData) => {
      const next = await createChangeRequestAction(previous, formData);
      if (next.status === "success") {
        setOpen(false);
        setType(isWorkingShift(shift) ? "UNAVAILABLE" : "SWAP");
        setTargetShift("");
        setCounterpartId("");
        setReasonCode("");
        setNote("");
      }
      return next;
    },
    { status: "idle" },
  );
  const errors = state.status === "error" ? (state.fields ?? {}) : {};
  const reason = reasons.find((r) => r.code === reasonCode);
  const noteRequired = reason?.requiresNote ?? false;
  const otherShifts = SHIFT_CODES.filter((code) => code !== shift);

  return (
    <div className="flex flex-col gap-1.5">
      <Button
        variant="outline"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-label={`درخواست تغییر برای ${dateLabel}`}
        className="w-full sm:w-auto"
      >
        <FilePlus2 aria-hidden="true" className="size-4" />
        درخواست تغییر
      </Button>
      <p
        role="status"
        className={
          state.status === "success" && !open
            ? "text-sm leading-relaxed text-muted-foreground"
            : "sr-only"
        }
      >
        {state.status === "success" && !open ? state.message : null}
      </p>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="درخواست تغییر شیفت"
        description={
          <span className="flex flex-wrap items-center gap-2">
            {dateLabel}
            <ShiftChip code={shift} size="xs" label={shiftLabels[shift]} />
          </span>
        }
      >
        <form
          id={ids.form}
          action={formAction}
          className="flex flex-col gap-5"
          noValidate
        >
          <input type="hidden" name="scheduleId" value={scheduleId} />
          <input type="hidden" name="date" value={date} />

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-sm font-medium">نوع درخواست</legend>
            {CHANGE_REQUEST_TYPES.filter(
              (v) => v !== "UNAVAILABLE" || isWorkingShift(shift),
            ).map((value) => (
              <label
                key={value}
                className={cn(
                  "flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5",
                  "has-checked:border-primary has-checked:bg-brand-soft/50 has-focus-visible:ring-3 has-focus-visible:ring-ring",
                )}
              >
                <input
                  type="radio"
                  name="type"
                  value={value}
                  checked={type === value}
                  onChange={() => setType(value)}
                  className="mt-1 size-4 accent-primary"
                />
                <span className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium">
                    {REQUEST_TYPE_LABELS[value]}
                  </span>
                  <span className="text-xs leading-relaxed text-muted-foreground">
                    {REQUEST_TYPE_DESCRIPTIONS[value]}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>

          {type === "CHANGE_SHIFT" && (
            <fieldset
              className="flex flex-col gap-2"
              aria-describedby={errors.targetShift ? ids.target : undefined}
            >
              <legend className="mb-2 text-sm font-medium">
                شیفت درخواستی
              </legend>
              <div className="flex flex-wrap gap-2">
                {otherShifts.map((code) => (
                  <label
                    key={code}
                    className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md border px-3 has-checked:border-primary has-checked:bg-brand-soft/50 has-focus-visible:ring-3 has-focus-visible:ring-ring"
                  >
                    <input
                      type="radio"
                      name="targetShift"
                      value={code}
                      required
                      checked={targetShift === code}
                      onChange={() => setTargetShift(code)}
                      className="size-4 accent-primary"
                      aria-label={`${code} — ${shiftLabels[code]}`}
                    />
                    <ShiftChip
                      code={code}
                      size="xs"
                      label={shiftLabels[code]}
                    />
                  </label>
                ))}
              </div>
              <FieldError id={ids.target} message={errors.targetShift} />
            </fieldset>
          )}

          {type === "SWAP" && (
            <div className="flex flex-col gap-1.5">
              <label htmlFor={ids.counterpart} className="text-sm font-medium">
                همکار برای جابه‌جایی
              </label>
              {swapCandidates.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  در این روز همکاری با شیفت متفاوت در این برنامه نیست.
                </p>
              ) : (
                <select
                  id={ids.counterpart}
                  name="counterpartId"
                  required
                  value={counterpartId}
                  onChange={(event) => setCounterpartId(event.target.value)}
                  aria-invalid={errors.counterpartId ? true : undefined}
                  aria-describedby={
                    errors.counterpartId
                      ? `${ids.counterpart}-error`
                      : undefined
                  }
                  className={FIELD_CLASS}
                >
                  <option value="" disabled>
                    انتخاب همکار
                  </option>
                  {swapCandidates.map((c) => (
                    <option key={c.userId} value={c.userId}>
                      {`${c.displayName} — ${decisionPhrase(c.shift, shiftLabels)}${c.shift ? ` (${c.shift})` : ""}`}
                    </option>
                  ))}
                </select>
              )}
              <p className="text-xs leading-relaxed text-muted-foreground">
                شیفت شما و همکار در همین روز جابه‌جا می‌شود. همکار باید موافقت
                کند و تصمیم نهایی با سرپرستار است.
              </p>
              <FieldError
                id={`${ids.counterpart}-error`}
                message={errors.counterpartId}
              />
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <label htmlFor={ids.reason} className="text-sm font-medium">
              علت
            </label>
            <select
              id={ids.reason}
              name="reasonCode"
              required
              value={reasonCode}
              onChange={(event) => setReasonCode(event.target.value)}
              aria-invalid={errors.reasonCode ? true : undefined}
              aria-describedby={
                errors.reasonCode ? `${ids.reason}-error` : undefined
              }
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
            <FieldError
              id={`${ids.reason}-error`}
              message={errors.reasonCode}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor={ids.note} className="text-sm font-medium">
              توضیح{noteRequired ? " (الزامی)" : " (اختیاری)"}
            </label>
            <textarea
              id={ids.note}
              name="note"
              rows={3}
              dir="auto"
              required={noteRequired}
              maxLength={CHANGE_NOTE_MAX_LENGTH}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              aria-invalid={errors.note ? true : undefined}
              aria-describedby={`${ids.noteHint}${errors.note ? ` ${ids.note}-error` : ""}`}
              className={cn(FIELD_CLASS, "min-h-20 leading-relaxed")}
            />
            <p
              id={ids.noteHint}
              className="flex justify-between gap-3 text-xs text-muted-foreground"
            >
              <span>
                {noteRequired
                  ? "برای این علت، توضیح بنویسید."
                  : "اگر لازم است، توضیح کوتاهی بنویسید."}
              </span>
              <span className="shrink-0 tabular-nums">
                {faNumber(note.length)} / {faNumber(CHANGE_NOTE_MAX_LENGTH)}
              </span>
            </p>
            <FieldError id={`${ids.note}-error`} message={errors.note} />
          </div>

          {errors.date && (
            <FieldError id={`${ids.form}-date`} message={errors.date} />
          )}
          <div
            role="alert"
            className={
              state.status === "error"
                ? "rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2.5 text-sm leading-relaxed text-destructive"
                : "sr-only"
            }
          >
            {state.status === "error" ? state.message : null}
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            ثبت درخواست، برنامه را تغییر نمی‌دهد؛ سرپرستار درخواست را بررسی و در
            صورت پذیرش اعمال می‌کند.
          </p>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={() => setOpen(false)}>
              انصراف
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "در حال ثبت…" : "ثبت درخواست"}
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
