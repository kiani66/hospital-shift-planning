"use client";

import {
  CircleAlert,
  FileSpreadsheet,
  KeyRound,
  Printer,
  RotateCcw,
} from "lucide-react";
import Link from "next/link";
import type { Route } from "next";
import { useActionState, useId, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button, buttonClasses } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { IsoDate } from "@/domain/shared/dates";
import { formatJalaliDate } from "@/features/calendar/jalali";
import { formatJalaliInput } from "@/features/calendar/jalali-input";
import { MANAGEMENT_SELECT } from "@/features/management/form-fields";

import {
  commitImportAction,
  issueImportPasswordsAction,
  previewImportAction,
  type CommitState,
  type InitialPasswordsState,
  type PreviewRow,
  type PreviewState,
} from "./actions";
import {
  IMPORT_ACTION_LABELS,
  IMPORT_FIELD_LABELS,
  IMPORT_ROW_ERRORS,
} from "./presentation";

const faNumber = (n: number) => n.toLocaleString("fa-IR");
const ROLE_LABELS: Record<string, string> = {
  NURSE: "پرستار",
  HEAD_NURSE: "سرپرستار",
};
const ACTION_TONES = {
  CREATE: "brand-soft",
  ADD_MEMBERSHIP: "info",
  UNCHANGED: "muted",
  ERROR: "destructive",
} as const;

function ErrorBox({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-lg border border-destructive/35 bg-destructive/5 px-3 py-2.5 text-sm leading-relaxed text-destructive"
    >
      <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      {message}
    </div>
  );
}

function RowProblems({ row }: { row: PreviewRow }) {
  if (row.errors.length === 0) return null;
  return (
    <ul className="space-y-1 text-sm text-destructive">
      {row.errors.map((error) => (
        <li key={error}>
          {IMPORT_ROW_ERRORS[error]}
          {error === "IDENTITY_CONFLICT" && row.conflicts.length > 0 && (
            <>
              {" "}
              ({row.conflicts.map((f) => IMPORT_FIELD_LABELS[f]).join("، ")})
            </>
          )}
        </li>
      ))}
    </ul>
  );
}

function MatchedAccounts({ row }: { row: PreviewRow }) {
  return row.accountIds.map((id) => (
    <p key={id}>
      <Link className="underline" href={`/admin/personnel/${id}`}>
        {row.action === "ADD_MEMBERSHIP" || row.action === "UNCHANGED"
          ? "حساب موجود؛ استفاده مجدد بدون تغییر هویت و رمز"
          : "بررسی حساب دارای تعارض"}
      </Link>
    </p>
  ));
}

function PreviewTable({ rows }: { rows: readonly PreviewRow[] }) {
  return (
    <>
      {/* Phones: one card per row. */}
      <ul aria-label="ردیف‌های فایل" className="space-y-3 md:hidden">
        {rows.map((row) => (
          <li
            key={row.line}
            className={`rounded-xl border bg-card p-4 ${row.action === "ERROR" ? "border-destructive/40" : ""}`}
          >
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm text-muted-foreground">
                ردیف {faNumber(row.line)}
              </span>
              <Badge tone={ACTION_TONES[row.action]}>
                {IMPORT_ACTION_LABELS[row.action]}
              </Badge>
            </div>
            <p className="font-semibold">{row.values.displayName || "—"}</p>
            <p className="text-sm">
              شماره پرسنلی:{" "}
              <span dir="ltr" className="font-mono">
                {row.values.personnelNumber || "—"}
              </span>
            </p>
            {(row.values.email || row.values.mobile) && (
              <p dir="ltr" className="text-end text-sm text-muted-foreground">
                {[row.values.email, row.values.mobile]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            )}
            <p className="mb-2 text-sm text-muted-foreground">
              نقش:{" "}
              {ROLE_LABELS[row.values.role ?? ""] ??
                row.values.role ??
                "پرستار"}
            </p>
            <RowProblems row={row} />
            <MatchedAccounts row={row} />
          </li>
        ))}
      </ul>
      {/* Tablets and desktop: a table. */}
      <div className="hidden overflow-x-auto rounded-xl border bg-card md:block">
        <table className="w-full text-sm">
          <caption className="sr-only">پیش‌نمایش ردیف‌های فایل</caption>
          <thead className="bg-muted/60 text-start">
            <tr>
              {[
                "ردیف",
                "شماره پرسنلی",
                "نام و نام خانوادگی",
                "ایمیل / موبایل",
                "نقش",
                "نتیجه",
              ].map((h) => (
                <th
                  key={h}
                  scope="col"
                  className="px-3 py-2 text-start font-medium"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.line}
                className={`border-t align-top ${row.action === "ERROR" ? "bg-destructive/5" : ""}`}
              >
                <td className="px-3 py-2">{faNumber(row.line)}</td>
                <td className="px-3 py-2">
                  <span dir="ltr" className="font-mono">
                    {row.values.personnelNumber || "—"}
                  </span>
                </td>
                <td className="px-3 py-2">{row.values.displayName || "—"}</td>
                <td className="px-3 py-2" dir="ltr">
                  {[row.values.email, row.values.mobile]
                    .filter(Boolean)
                    .join(" · ") || "—"}
                </td>
                <td className="px-3 py-2">
                  {ROLE_LABELS[row.values.role ?? ""] ??
                    row.values.role ??
                    "پرستار"}
                </td>
                <td className="space-y-1 px-3 py-2">
                  <Badge tone={ACTION_TONES[row.action]}>
                    {IMPORT_ACTION_LABELS[row.action]}
                  </Badge>
                  <RowProblems row={row} />
                  <MatchedAccounts row={row} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function InitialPasswords({
  created,
}: {
  created: readonly {
    userId: string;
    personnelNumber: string;
    displayName: string;
  }[];
}) {
  const [state, action, pending] = useActionState<
    InitialPasswordsState,
    FormData
  >(issueImportPasswordsAction, { status: "idle" });
  const [hidden, setHidden] = useState(false);
  const batch = created.slice(0, 100);
  if (state.status === "issued" && !hidden)
    return (
      <section
        aria-label="رمزهای موقت"
        className="space-y-3 rounded-xl border border-status-info/40 bg-status-info/8 p-4 print:border-0"
      >
        <p className="text-sm font-semibold">
          رمزهای موقت (فقط همین یک بار نمایش داده می‌شوند):
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th scope="col" className="px-2 py-1 text-start">
                  شماره پرسنلی
                </th>
                <th scope="col" className="px-2 py-1 text-start">
                  نام
                </th>
                <th scope="col" className="px-2 py-1 text-start">
                  رمز موقت
                </th>
              </tr>
            </thead>
            <tbody>
              {state.results.map((r) => (
                <tr
                  key={`${r.personnelNumber}-${r.displayName}`}
                  className="border-t"
                >
                  <td className="px-2 py-1 font-mono" dir="ltr">
                    {r.personnelNumber}
                  </td>
                  <td className="px-2 py-1">{r.displayName}</td>
                  <td className="px-2 py-1 font-mono" dir="ltr">
                    {r.temporaryPassword ??
                      (r.status === "HAS_CREDENTIALS"
                        ? "رمز دارد؛ تغییری نکرد"
                        : "صادر نشد")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          هر رمز را جداگانه و امن به خود فرد بدهید. رمزها در سامانه ذخیره یا
          دوباره نمایش داده نمی‌شوند و هر فرد در اولین ورود باید رمز خود را
          تغییر دهد.
        </p>
        <div className="flex flex-wrap gap-2 print:hidden">
          <Button variant="outline" onClick={() => window.print()}>
            <Printer aria-hidden="true" className="size-4" />
            چاپ
          </Button>
          <Button onClick={() => setHidden(true)}>تحویل دادم؛ پنهان شود</Button>
        </div>
      </section>
    );
  if (state.status === "issued") return null;
  return (
    <form action={action} className="space-y-3 rounded-xl border bg-card p-4">
      <p className="text-sm leading-relaxed">
        حساب‌های جدید رمز ندارند و تا ساخت رمز موقت امکان ورود ندارند. می‌توانید
        برای {faNumber(batch.length)} حساب جدید همین حالا رمز موقت بسازید یا
        بعداً از صفحه هر فرد این کار را انجام دهید.
        {created.length > batch.length &&
          ` (حداکثر ۱۰۰ حساب در هر بار؛ ${faNumber(created.length - batch.length)} حساب دیگر را از صفحه هر فرد انجام دهید.)`}
      </p>
      {batch.map((c) => (
        <input key={c.userId} type="hidden" name="userId" value={c.userId} />
      ))}
      {state.status === "error" && <ErrorBox message={state.message} />}
      <Button type="submit" disabled={pending}>
        <KeyRound aria-hidden="true" className="size-4" />
        {pending ? "در حال ساخت…" : "ساخت رمز موقت برای حساب‌های جدید"}
      </Button>
    </form>
  );
}

function CommitPanel({
  preview,
  onRestart,
}: {
  preview: Extract<PreviewState, { status: "preview" }>;
  onRestart: () => void;
}) {
  const confirmId = useId();
  const [state, action, pending] = useActionState<CommitState, FormData>(
    commitImportAction,
    { status: "idle" },
  );
  if (state.status === "committed") {
    const { outcome } = state;
    return (
      <section aria-label="نتیجه ثبت" className="space-y-4">
        <Callout icon={FileSpreadsheet} tone="success">
          ثبت انجام شد: {faNumber(outcome.created.length)} حساب جدید،{" "}
          {faNumber(outcome.membershipsAdded)} عضویت جدید و{" "}
          {faNumber(outcome.unchanged)} ردیف بدون تغییر. برنامه‌های موجود تغییری
          نکرده‌اند؛ افزودن افراد به فهرست برنامه‌های پیش‌نویس توسط سرپرستار
          انجام می‌شود.
        </Callout>
        {outcome.created.length > 0 && (
          <>
            <ul className="grid gap-2 sm:grid-cols-2">
              {outcome.created.map((c) => (
                <li
                  key={c.userId}
                  className="rounded-lg border bg-card px-3 py-2 text-sm"
                >
                  <Link
                    href={`/admin/personnel/${c.userId}` as Route}
                    className="font-semibold text-primary underline-offset-4 hover:underline"
                  >
                    {c.displayName}
                  </Link>{" "}
                  <span dir="ltr" className="font-mono text-muted-foreground">
                    {c.personnelNumber}
                  </span>
                </li>
              ))}
            </ul>
            <InitialPasswords created={outcome.created} />
          </>
        )}
        <Button variant="outline" onClick={onRestart}>
          <RotateCcw aria-hidden="true" className="size-4" />
          ورود فایل دیگر
        </Button>
      </section>
    );
  }
  return (
    <form action={action} className="space-y-4 rounded-xl border bg-card p-4">
      <input
        type="hidden"
        name="payload"
        value={JSON.stringify(preview.payload)}
      />
      {!preview.committable ? (
        <Callout icon={CircleAlert} tone="attention">
          {faNumber(preview.counts.ERROR)} ردیف خطا دارد. ورود گروهی همه‌یا‌هیچ
          است: فایل را اصلاح و دوباره بارگذاری کنید.
        </Callout>
      ) : !preview.hasChanges ? (
        <Callout icon={FileSpreadsheet} tone="muted">
          همه ردیف‌ها قبلاً با همین اطلاعات ثبت شده‌اند؛ چیزی برای ثبت نیست.
        </Callout>
      ) : (
        <div className="flex items-start gap-3">
          <input
            id={confirmId}
            type="checkbox"
            name="confirm"
            required
            className="mt-1 size-4 accent-primary"
          />
          <label htmlFor={confirmId} className="text-sm leading-relaxed">
            پیش‌نمایش را بررسی کردم. {faNumber(preview.counts.CREATE)} حساب جدید
            بدون رمز ساخته شود و{" "}
            {faNumber(preview.counts.CREATE + preview.counts.ADD_MEMBERSHIP)}{" "}
            عضویت در «{preview.department.name}» از{" "}
            {formatJalaliDate(preview.startedOn as IsoDate)} ثبت شود.
          </label>
        </div>
      )}
      {state.status === "error" && <ErrorBox message={state.message} />}
      <div className="flex flex-wrap gap-2">
        {preview.committable && preview.hasChanges && (
          <Button type="submit" disabled={pending}>
            {pending ? "در حال ثبت…" : "ثبت نهایی"}
          </Button>
        )}
        <Button variant="outline" onClick={onRestart} disabled={pending}>
          انتخاب فایل دیگر
        </Button>
      </div>
    </form>
  );
}

export function ImportWizard({
  departments,
  today,
}: {
  departments: readonly { id: string; code: string; name: string }[];
  today: IsoDate;
}) {
  const fileId = useId();
  const departmentId = useId();
  const dateId = useId();
  // Remounting the upload form (new key) discards the previous preview.
  const [round, setRound] = useState(0);
  return (
    <UploadStep
      key={round}
      {...{ departments, today, fileId, departmentId, dateId }}
      onRestart={() => setRound((r) => r + 1)}
    />
  );
}

function UploadStep({
  departments,
  today,
  fileId,
  departmentId,
  dateId,
  onRestart,
}: {
  departments: readonly { id: string; code: string; name: string }[];
  today: IsoDate;
  fileId: string;
  departmentId: string;
  dateId: string;
  onRestart: () => void;
}) {
  const [state, action, pending] = useActionState<PreviewState, FormData>(
    previewImportAction,
    { status: "idle" },
  );
  const [department, setDepartment] = useState(departments[0]?.id ?? "");
  const [startedOn, setStartedOn] = useState(formatJalaliInput(today));

  if (state.status === "preview")
    return (
      <div className="space-y-5">
        <section aria-label="خلاصه پیش‌نمایش" className="space-y-3">
          <p className="text-sm">
            بخش «{state.department.name}»، شروع عضویت{" "}
            {formatJalaliDate(state.startedOn as IsoDate)} ·{" "}
            {faNumber(state.rows.length)} ردیف
          </p>
          <ul className="flex flex-wrap gap-2" aria-label="شمار نتیجه‌ها">
            {(["CREATE", "ADD_MEMBERSHIP", "UNCHANGED", "ERROR"] as const).map(
              (a) => (
                <li key={a}>
                  <Badge tone={ACTION_TONES[a]}>
                    {IMPORT_ACTION_LABELS[a]}: {faNumber(state.counts[a])}
                  </Badge>
                </li>
              ),
            )}
          </ul>
          {state.ignoredColumns.length > 0 && (
            <p className="text-sm text-muted-foreground">
              ستون‌های نادیده گرفته‌شده: {state.ignoredColumns.join("، ")}
            </p>
          )}
        </section>
        <PreviewTable rows={state.rows} />
        <CommitPanel preview={state} onRestart={onRestart} />
      </div>
    );

  return (
    <form
      action={action}
      aria-label="بارگذاری فایل پرسنل"
      className="max-w-xl space-y-5 rounded-xl border bg-card p-5"
    >
      <fieldset disabled={pending} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor={fileId}>فایل CSV</Label>
          <Input
            id={fileId}
            name="file"
            type="file"
            accept=".csv,text/csv"
            required
            aria-describedby={`${fileId}-help`}
            className="min-h-11 py-2"
          />
          <p id={`${fileId}-help`} className="text-xs text-muted-foreground">
            حداکثر ۲۵۶ کیلوبایت و ۵۰۰ ردیف، با کدگذاری UTF-8. رمز عبور در فایل
            نباشد.
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor={departmentId}>بخش مقصد</Label>
          <select
            id={departmentId}
            name="departmentId"
            value={department}
            onChange={(e) => setDepartment(e.target.value)}
            className={MANAGEMENT_SELECT}
            required
          >
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor={dateId}>تاریخ شروع عضویت (شمسی)</Label>
          <Input
            id={dateId}
            name="startedOn"
            value={startedOn}
            onChange={(e) => setStartedOn(e.target.value)}
            dir="ltr"
            inputMode="numeric"
            placeholder="۱۴۰۵/۰۷/۱۲"
            aria-describedby={`${dateId}-help`}
            className="min-h-11 text-start"
          />
          <p id={`${dateId}-help`} className="text-xs text-muted-foreground">
            سال/ماه/روز؛ عضویت‌های جدید از این روز و بدون تاریخ پایان ثبت
            می‌شوند.
          </p>
        </div>
      </fieldset>
      {state.status === "error" && <ErrorBox message={state.message} />}
      <Button type="submit" disabled={pending || departments.length === 0}>
        {pending ? "در حال بررسی…" : "بررسی و پیش‌نمایش"}
      </Button>
      <p className="text-xs text-muted-foreground">
        در این مرحله چیزی ذخیره نمی‌شود.
      </p>
      <a
        href="/personnel-import-sample.csv"
        download="personnel-import-sample.csv"
        className={buttonClasses("ghost", "px-0")}
      >
        <FileSpreadsheet aria-hidden="true" className="size-4" />
        دریافت فایل نمونه CSV
      </a>
    </form>
  );
}
