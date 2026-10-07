"use client";

import { CalendarClock, Plus, Save, Send, Trash2, X } from "lucide-react";
import { useActionState, useId, useState, type ReactNode } from "react";

import type { PublishPreview } from "@/application/staffing-rules/queries";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { COVERAGE_PERIODS, type BaseShift } from "@/domain/shifts/shift-type";
import { faNumber, formatJalaliDate } from "@/features/calendar/jalali";
import { formatJalaliInput } from "@/features/calendar/jalali-input";

import {
  createDraftAction,
  discardDraftAction,
  previewPublishAction,
  publishAction,
  retireAction,
  updateDraftAction,
  type RuleSetFormState,
} from "./actions";
import {
  BUCKET_NAMES,
  RULE_SET_STATE_LABELS,
  versionLabel,
  type ContentFormValue,
} from "./presentation";

const IDLE: RuleSetFormState = { status: "idle" };

const inputClass =
  "h-10 w-full min-w-0 rounded-md border border-input bg-background px-2 text-sm tabular-nums shadow-xs focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-none pointer-coarse:h-11";

/** A server message under a form, announced to assistive technology. */
function FormMessage({ state }: { state: RuleSetFormState }) {
  if (!state.message) return <div role="status" className="sr-only" />;
  return (
    <p
      role={state.status === "error" ? "alert" : "status"}
      className={
        state.status === "error"
          ? "rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
          : "text-sm text-status-success-foreground"
      }
    >
      {state.message}
    </p>
  );
}

/** "ایجاد پیش‌نویس" for a scope, optionally copying a chosen version. */
export function CreateDraftButton({
  departmentId,
  basedOnVersionId,
  label,
}: {
  departmentId: string | null;
  basedOnVersionId?: string;
  label: string;
}) {
  const [state, action, pending] = useActionState(createDraftAction, IDLE);
  return (
    <form action={action} className="flex flex-col gap-1">
      <input type="hidden" name="departmentId" value={departmentId ?? ""} />
      {basedOnVersionId && (
        <input type="hidden" name="basedOnVersionId" value={basedOnVersionId} />
      )}
      <Button type="submit" variant="outline" disabled={pending}>
        <Plus aria-hidden="true" className="size-4" />
        {pending ? "در حال ساخت…" : label}
      </Button>
      {state.status === "error" && <FormMessage state={state} />}
    </form>
  );
}

/** A command behind a confirmation dialog (discard a draft, withdraw a version). */
export function ConfirmRuleSetAction({
  action,
  fields,
  triggerLabel,
  title,
  description,
  confirmLabel,
  withNote = false,
}: {
  action: "discard" | "retire";
  fields: Record<string, string>;
  triggerLabel: string;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  withNote?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const noteId = useId();
  const [state, formAction, pending] = useActionState(
    async (previous: RuleSetFormState, form: FormData) => {
      const next = await (
        action === "discard" ? discardDraftAction : retireAction
      )(previous, form);
      if (next.status === "success") setOpen(false);
      return next;
    },
    IDLE,
  );
  return (
    <>
      <Button
        variant="outline"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
      >
        <Trash2 aria-hidden="true" className="size-4" />
        {triggerLabel}
      </Button>
      {state.status === "success" && <FormMessage state={state} />}
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={title}
        description={description}
      >
        <form action={formAction} className="flex flex-col gap-4">
          {Object.entries(fields).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))}
          {withNote && (
            <div className="flex flex-col gap-1.5">
              <label htmlFor={noteId} className="text-sm font-medium">
                توضیح (اختیاری)
              </label>
              <textarea
                id={noteId}
                name="note"
                rows={3}
                maxLength={500}
                dir="auto"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-none"
              />
            </div>
          )}
          <FormMessage state={state.status === "error" ? state : IDLE} />
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" autoFocus onClick={() => setOpen(false)}>
              انصراف
            </Button>
            <Button type="submit" variant="destructive" disabled={pending}>
              {pending ? "در حال انجام…" : confirmLabel}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}

function BoundsInputs({
  prefix,
  period,
  value,
  disabled = false,
}: {
  prefix: "normal" | "holiday";
  period: BaseShift;
  value: { min: number; max: number | null } | undefined;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="grid grid-cols-2 gap-2">
      <label className="flex flex-col gap-1 text-xs" htmlFor={`${id}-min`}>
        حداقل
        <input
          id={`${id}-min`}
          name={`${prefix}.${period}.min`}
          inputMode="numeric"
          defaultValue={value?.min ?? ""}
          disabled={disabled}
          required={!disabled}
          className={inputClass}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs" htmlFor={`${id}-max`}>
        حداکثر (خالی: بدون حداکثر)
        <input
          id={`${id}-max`}
          name={`${prefix}.${period}.max`}
          inputMode="numeric"
          defaultValue={value?.max ?? ""}
          disabled={disabled}
          className={inputClass}
        />
      </label>
    </div>
  );
}

interface ExceptionRow {
  readonly key: number;
  readonly date: string;
  readonly period: BaseShift;
  readonly min: string;
  readonly max: string;
  readonly note: string;
}

/**
 * Edits a DRAFT: NORMAL bounds per bucket, optional HOLIDAY bounds per
 * bucket, specific-date exceptions and a note. Only drafts are editable
 * (D105); the server checks again.
 */
export function DraftEditor({
  versionId,
  revision,
  value,
  note,
}: {
  versionId: string;
  revision: number;
  value: ContentFormValue;
  note: string | null;
}) {
  const [state, action, pending] = useActionState(updateDraftAction, IDLE);
  // Which buckets have their own holiday rule. The checkboxes use
  // `defaultChecked` (kept equal to this state on every render), not `checked`:
  // React resets a `<form action>` after the action finishes, and a controlled
  // checkbox would then fall back to its first-render attribute (React does not
  // re-apply `checked`), showing a different state than this one and than the
  // stored rule, and submitting it on the next save.
  const [holiday, setHoliday] = useState<Record<BaseShift, boolean>>({
    M: !!value.holiday.M,
    E: !!value.holiday.E,
    N: !!value.holiday.N,
  });
  const [rows, setRows] = useState<ExceptionRow[]>(
    value.exceptions.map((e, key) => ({
      key,
      date: formatJalaliInput(e.date as never),
      period: e.period,
      min: String(e.bounds.min),
      max: e.bounds.max === null ? "" : String(e.bounds.max),
      note: e.note ?? "",
    })),
  );
  const [next, setNext] = useState(rows.length);
  const noteId = useId();
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="versionId" value={versionId} />
      <input type="hidden" name="expectedRevision" value={revision} />
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-semibold">روزهای عادی</legend>
        <div className="grid gap-3 sm:grid-cols-3">
          {COVERAGE_PERIODS.map((p) => (
            <div key={p} className="flex flex-col gap-1 rounded-lg border p-2">
              <span className="text-sm font-medium">
                {BUCKET_NAMES[p]} <span dir="ltr">({p})</span>
              </span>
              <BoundsInputs
                prefix="normal"
                period={p}
                value={value.normal[p]}
              />
            </div>
          ))}
        </div>
      </fieldset>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-semibold">
          روزهای تعطیل رسمی
        </legend>
        <p className="text-xs leading-relaxed text-muted-foreground">
          فقط وقتی اعمال می‌شود که تقویم تعطیلات رسمی به سامانه متصل باشد؛ اکنون
          منبع تعطیلات متصل نیست و روزی تعطیل شمرده نمی‌شود. نوبت بدون قانون
          تعطیل از قانون روز عادی پیروی می‌کند.
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          {COVERAGE_PERIODS.map((p) => (
            <div key={p} className="flex flex-col gap-1 rounded-lg border p-2">
              <label className="flex items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  name={`holiday.${p}.enabled`}
                  defaultChecked={holiday[p]}
                  onChange={(e) =>
                    setHoliday((h) => ({ ...h, [p]: e.target.checked }))
                  }
                  className="size-4"
                />
                قانون جدا برای {BUCKET_NAMES[p]}
              </label>
              <BoundsInputs
                prefix="holiday"
                period={p}
                value={value.holiday[p]}
                disabled={!holiday[p]}
              />
            </div>
          ))}
        </div>
      </fieldset>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-semibold">
          استثنای تاریخ‌های مشخص
        </legend>
        <p className="text-xs text-muted-foreground">
          برای یک تاریخ و نوبت، بر قانون روز عادی و تعطیل مقدم است.
        </p>
        {rows.length === 0 && (
          <p className="text-sm text-muted-foreground">
            استثنایی تعریف نشده است.
          </p>
        )}
        <ul className="flex flex-col gap-2">
          {rows.map((row, i) => (
            <li
              key={row.key}
              className="grid grid-cols-2 items-end gap-2 rounded-lg border p-2 sm:grid-cols-[8rem_6rem_5rem_5rem_minmax(0,1fr)_auto]"
            >
              <label className="flex flex-col gap-1 text-xs">
                تاریخ
                <input
                  name="exception.date"
                  defaultValue={row.date}
                  placeholder="۱۴۰۵/۰۸/۱۵"
                  required
                  className={inputClass}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs">
                نوبت
                <select
                  name="exception.period"
                  defaultValue={row.period}
                  className={inputClass}
                >
                  {COVERAGE_PERIODS.map((p) => (
                    <option key={p} value={p}>
                      {BUCKET_NAMES[p]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs">
                حداقل
                <input
                  name="exception.min"
                  inputMode="numeric"
                  defaultValue={row.min}
                  required
                  className={inputClass}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs">
                حداکثر
                <input
                  name="exception.max"
                  inputMode="numeric"
                  defaultValue={row.max}
                  className={inputClass}
                />
              </label>
              <label className="col-span-2 flex flex-col gap-1 text-xs sm:col-span-1">
                توضیح
                <input
                  name="exception.note"
                  defaultValue={row.note}
                  maxLength={500}
                  className={inputClass}
                />
              </label>
              <Button
                variant="ghost"
                aria-label={`حذف استثنای ردیف ${faNumber(i + 1)}`}
                onClick={() =>
                  setRows((r) => r.filter((x) => x.key !== row.key))
                }
              >
                <X aria-hidden="true" className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
        <div>
          <Button
            variant="outline"
            onClick={() => {
              setRows((r) => [
                ...r,
                {
                  key: next,
                  date: "",
                  period: "M",
                  min: "",
                  max: "",
                  note: "",
                },
              ]);
              setNext((n) => n + 1);
            }}
          >
            <Plus aria-hidden="true" className="size-4" />
            افزودن استثنا
          </Button>
        </div>
      </fieldset>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={noteId} className="text-sm font-medium">
          یادداشت نسخه (اختیاری)
        </label>
        <textarea
          id={noteId}
          name="note"
          rows={2}
          maxLength={500}
          dir="auto"
          defaultValue={note ?? ""}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-none"
        />
      </div>
      <FormMessage state={state} />
      <div>
        <Button type="submit" disabled={pending}>
          <Save aria-hidden="true" className="size-4" />
          {pending ? "در حال ذخیره…" : "ذخیره پیش‌نویس"}
        </Button>
      </div>
    </form>
  );
}

/**
 * Publishes a DRAFT effective today or from a future day. "Check" asks the
 * server what the publication would replace (nothing is written); a
 * conflict with a scheduled version must be confirmed explicitly, and only
 * the versions shown are sent as confirmed (K). Existing schedules keep
 * their pins in every case (D106).
 */
export function PublishDialog({
  versionId,
  versionNo,
  revision,
}: {
  versionId: string;
  versionNo: number;
  revision: number;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"now" | "date">("now");
  const [date, setDate] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [checked, check, checking] = useActionState(previewPublishAction, IDLE);
  const [published, publish, publishing] = useActionState(
    async (previous: RuleSetFormState, form: FormData) => {
      const next = await publishAction(previous, form);
      if (next.status === "success") setOpen(false);
      return next;
    },
    IDLE,
  );
  const preview: PublishPreview | undefined = checked.preview;
  const conflicts = preview?.conflicts ?? [];
  const reset = () => setConfirmed(false);
  const dateId = useId();

  return (
    <>
      <Button onClick={() => setOpen(true)} aria-haspopup="dialog">
        <Send aria-hidden="true" className="size-4 rtl:-scale-x-100" />
        انتشار…
      </Button>
      {published.status === "success" && <FormMessage state={published} />}
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={`انتشار ${versionLabel(versionNo)}`}
        description="پس از انتشار، این نسخه تغییرناپذیر است. برنامه‌های موجود به نسخه فعلی خود متصل می‌مانند؛ تغییر قوانین یک برنامه فقط با «اعمال نسخه» و پیش‌نمایش ممکن است."
      >
        <div className="flex flex-col gap-4">
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">
              از چه تاریخی اجرا شود؟
            </legend>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="mode-choice"
                checked={mode === "now"}
                onChange={() => {
                  setMode("now");
                  reset();
                }}
              />
              از امروز (فوری)
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="mode-choice"
                checked={mode === "date"}
                onChange={() => {
                  setMode("date");
                  reset();
                }}
              />
              از تاریخی در آینده
            </label>
            {mode === "date" && (
              <label htmlFor={dateId} className="flex flex-col gap-1 text-sm">
                تاریخ اجرا
                <input
                  id={dateId}
                  value={date}
                  onChange={(e) => {
                    setDate(e.target.value);
                    reset();
                  }}
                  placeholder="۱۴۰۵/۰۹/۰۱"
                  className={inputClass}
                />
              </label>
            )}
          </fieldset>

          <form action={check}>
            <input type="hidden" name="versionId" value={versionId} />
            <input type="hidden" name="mode" value={mode} />
            <input type="hidden" name="effectiveFrom" value={date} />
            <Button type="submit" variant="outline" disabled={checking}>
              <CalendarClock aria-hidden="true" className="size-4" />
              {checking ? "در حال بررسی…" : "بررسی تداخل"}
            </Button>
          </form>
          <FormMessage state={checked.status === "error" ? checked : IDLE} />

          {preview && (
            <div
              role="status"
              data-publish-preview={conflicts.length > 0 ? "conflict" : "clear"}
              className="flex flex-col gap-2 rounded-lg border p-3 text-sm"
            >
              <p>
                اجرا{" "}
                {preview.immediate
                  ? "از امروز"
                  : `از ${formatJalaliDate(preview.effectiveFrom)}`}
                .
              </p>
              {conflicts.length === 0 ? (
                <p>تداخلی با نسخه‌های زمان‌بندی‌شده وجود ندارد.</p>
              ) : (
                <>
                  <p className="font-semibold text-destructive">
                    این انتشار با نسخه‌های زیر تداخل دارد و آن‌ها را کنار
                    می‌گذارد (بازنشسته می‌شوند):
                  </p>
                  <ul className="list-disc ps-5">
                    {conflicts.map((c) => (
                      <li key={c.versionId}>
                        {versionLabel(c.versionNo)} ·{" "}
                        {RULE_SET_STATE_LABELS[c.state]} · اجرا از{" "}
                        {formatJalaliDate(c.effectiveFrom)}
                        {c.pinnedSchedules > 0 &&
                          ` · ${faNumber(c.pinnedSchedules)} برنامه به آن متصل است و متصل می‌ماند`}
                      </li>
                    ))}
                  </ul>
                  <label className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      checked={confirmed}
                      onChange={(e) => setConfirmed(e.target.checked)}
                      className="mt-1 size-4"
                    />
                    جایگزینی و بازنشسته‌شدن نسخه‌های بالا را تأیید می‌کنم.
                  </label>
                </>
              )}
            </div>
          )}

          <form action={publish} className="flex flex-col gap-3">
            <input type="hidden" name="versionId" value={versionId} />
            <input type="hidden" name="expectedRevision" value={revision} />
            <input type="hidden" name="mode" value={mode} />
            <input type="hidden" name="effectiveFrom" value={date} />
            {confirmed &&
              conflicts.map((c) => (
                <input
                  key={c.versionId}
                  type="hidden"
                  name="confirmReplace"
                  value={c.versionId}
                />
              ))}
            <FormMessage
              state={published.status === "error" ? published : IDLE}
            />
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="outline" onClick={() => setOpen(false)}>
                انصراف
              </Button>
              <Button
                type="submit"
                disabled={
                  publishing || !preview || (conflicts.length > 0 && !confirmed)
                }
              >
                {publishing ? "در حال انتشار…" : "انتشار نسخه"}
              </Button>
            </div>
          </form>
        </div>
      </Dialog>
    </>
  );
}
