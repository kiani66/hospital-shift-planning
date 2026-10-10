"use client";
import { useState, useTransition } from "react";
import type { FullResetPreview } from "@/application/reset/preview";
import {
  CATEGORY_IDS,
  FULL_OPERATIONAL_CATEGORIES,
  RESET_CATEGORIES,
  type ResetCategory,
} from "@/domain/reset/categories";
import { Button } from "@/components/ui/button";
import { faNumber } from "@/features/calendar/jalali";
import { Dialog } from "@/components/ui/dialog";
import { executeFullResetAction, previewFullResetAction } from "./full-actions";
import { PersonnelReadiness } from "./personnel-readiness";
function resetMessage(code: string) {
  const [kind, detail] = code.split(":");
  const messages: Record<string, string> = {
    EMPTY_DEPARTMENT_SCOPE: "حداقل یک بخش را انتخاب کنید.",
    UNKNOWN_DEPARTMENT: "یکی از بخش‌های انتخاب‌شده دیگر موجود نیست.",
    NO_USABLE_ADMIN:
      "حداقل یک مدیر فعال با رمز عبور قابل استفاده باید باقی بماند.",
    PROTECTED_ADMIN: "این انتخاب حساب مدیر محافظت‌شده را درگیر می‌کند.",
    CROSS_SCOPE_DEPENDENCY:
      "داده‌ای خارج از دامنه انتخاب‌شده به این داده وابسته است؛ دامنه را صریحاً اصلاح کنید یا داده مرجع را حفظ کنید.",
    EXPLICIT_MASTER_SELECTION_REQUIRED:
      "حذف وابستگی به انتخاب صریح داده پایه نیاز دارد.",
    UNSUPPORTED_FOREIGN_KEY:
      "وابستگی پایگاه داده خارج از دسته‌های شناخته‌شده است؛ اجرای امن ممکن نیست.",
    SHARED_OR_REFERENCED_PERSONNEL_PRESERVED:
      "افراد مشترک با بخش‌های دیگر یا دارای وابستگی باقی‌مانده حفظ می‌شوند.",
    GLOBAL_MASTER_DATA_EXPLICITLY_SELECTED:
      "داده پایه سراسری صریحاً انتخاب شده است؛ این تعریف‌ها برای همه سامانه حذف می‌شوند.",
    APPROVED_PILOT_SCHEDULES_WILL_BE_DELETED:
      "برنامه آزمایشی تأییدشده نیز پس از تأیید این بازنشانی حذف می‌شود.",
  };
  return `${messages[kind!] ?? "اعتبارسنجی این انتخاب نیاز به بررسی دارد."}${detail ? ` (${detail})` : ""}`;
}
export function FullResetControl({
  departments,
}: {
  departments: readonly { id: string; name: string }[];
}) {
  const [confirm, setConfirm] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [application, setApplication] = useState(false);
  const [departmentIds, setDepartmentIds] = useState<string[]>([]);
  const [categories, setCategories] = useState<ResetCategory[]>(
    FULL_OPERATIONAL_CATEGORIES,
  );
  const [preview, setPreview] = useState<FullResetPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const auto = new Set(preview?.plan.automatic.map((a) => a.category));
  function change() {
    setPreview(null);
    setConfirm(false);
    setCompleted(false);
    setError(null);
  }
  return (
    <div className="flex flex-col gap-5">
      {completed && <p role="status">بازنشانی انجام شد؛ سابقه مستقل ثبت شد.</p>}
      <p>
        استثنای بازنشانی داده آزمایشی: برنامه‌های تأییدشده و تاریخچه منتخب نیز
        ممکن است حذف شوند. مدیر محافظت‌شده و سابقه مستقل بازنشانی باقی می‌مانند.
      </p>
      <label>
        <input
          type="checkbox"
          checked={application}
          disabled={pending}
          onChange={(e) => {
            change();
            setApplication(e.target.checked);
          }}
        />{" "}
        دامنه همه سامانه
      </label>
      {!application && (
        <fieldset className="flex flex-col gap-2">
          <legend>بخش‌های موردنظر</legend>
          {departments.length === 0 ? (
            <p>هیچ بخشی وجود ندارد؛ دامنه همه سامانه همچنان در دسترس است.</p>
          ) : (
            departments.map((d) => (
              <label key={d.id}>
                <input
                  type="checkbox"
                  checked={departmentIds.includes(d.id)}
                  disabled={pending}
                  onChange={(e) => {
                    change();
                    setDepartmentIds(
                      e.target.checked
                        ? [...departmentIds, d.id]
                        : departmentIds.filter((id) => id !== d.id),
                    );
                  }}
                />{" "}
                {d.name}
              </label>
            ))
          )}
        </fieldset>
      )}
      <Button
        variant="outline"
        disabled={pending}
        onClick={() => {
          change();
          setCategories(FULL_OPERATIONAL_CATEGORIES);
        }}
      >
        انتخاب بازنشانی کامل عملیاتی
      </Button>
      <fieldset className="grid gap-3 sm:grid-cols-2">
        <legend>دسته‌های داده</legend>
        {CATEGORY_IDS.map((id) => {
          const c = RESET_CATEGORIES[id];
          const counts = preview?.plan.tables.filter((t) => t.category === id);
          return (
            <div key={id} className="rounded-lg border p-3">
              <label className="font-medium">
                <input
                  type="checkbox"
                  checked={categories.includes(id) || auto.has(id)}
                  disabled={pending || auto.has(id)}
                  onChange={(e) => {
                    change();
                    setCategories(
                      e.target.checked
                        ? [...categories, id]
                        : categories.filter((c) => c !== id),
                    );
                  }}
                />{" "}
                {c.label}
                {c.master ? " (داده پایه؛ اختیاری)" : ""}
              </label>
              <p>{c.description}</p>
              <details>
                <summary>جدول‌های زیرین</summary>
                <p dir="ltr" className="text-sm break-all">
                  {c.tables.join(", ")}
                </p>
              </details>
              {counts && (
                <p>
                  {faNumber(counts.reduce((n, t) => n + t.remove, 0))} حذف /{" "}
                  {faNumber(counts.reduce((n, t) => n + t.preserve, 0))} حفظ
                </p>
              )}
              {auto.has(id) && (
                <p>
                  انتخاب وابسته و قفل‌شده برای جلوگیری از باقی ماندن ارجاع به
                  داده حذف‌شده:{" "}
                  {preview?.plan.automatic
                    .find((a) => a.category === id)
                    ?.reasons.join("، ")}
                </p>
              )}
            </div>
          );
        })}
      </fieldset>
      <Button
        disabled={
          pending ||
          categories.length === 0 ||
          (!application && departmentIds.length === 0)
        }
        onClick={() =>
          start(async () => {
            setError(null);
            const result = await previewFullResetAction({
              scope: application
                ? { kind: "APPLICATION" }
                : { kind: "DEPARTMENTS", departmentIds },
              categories,
            });
            if (result.ok) setPreview(result.data);
            else
              setError(
                "پیش‌نمایش در دسترس نیست؛ دسترسی و انتخاب‌ها را بررسی کنید.",
              );
          })
        }
      >
        {pending ? "در حال بررسی…" : "نمایش پیش‌نمایش بازنشانی"}
      </Button>
      {error && <p role="alert">{error}</p>}
      {preview && (
        <section
          aria-label="پیش‌نمایش بازنشانی"
          className="flex flex-col gap-3 rounded-lg border p-4"
        >
          <h2 className="font-bold">پیش‌نمایش بازنشانی</h2>
          <p>
            دامنه:{" "}
            {application
              ? "همه سامانه"
              : departments
                  .filter((d) => preview.affectedDepartmentIds.includes(d.id))
                  .map((d) => d.name)
                  .join("، ")}
          </p>
          <p>
            بخش‌های درگیر:{" "}
            {departments
              .filter((d) => preview.affectedDepartmentIds.includes(d.id))
              .map((d) => d.name)
              .join("، ") || "هیچ بخش"}
          </p>
          <p>
            بخش‌های حذف‌شونده:{" "}
            {preview.departments.map((d) => d.label).join("، ") || "هیچ بخش"}
          </p>
          <p>
            مدیران محافظت‌شده: {faNumber(preview.plan.protectedUserIds.length)}؛
            افراد دارای وابستگی باقی‌مانده:{" "}
            {faNumber(preview.plan.preservedUserIds.length)}
          </p>
          <p>
            پرسنل حذف‌شونده:{" "}
            {preview.users.map((u) => u.label).join("، ") || "هیچ‌کس"}
          </p>
          <p>
            مدیران و افراد مشترک حفظ‌شونده:{" "}
            {preview.preservedUsers.map((u) => u.label).join("، ") || "هیچ‌کس"}
          </p>
          <PersonnelReadiness preview={preview} />
          <p>
            برنامه‌های حذف‌شونده:{" "}
            {preview.schedules
              .map((s) => `${s.label} (${s.status})`)
              .join("، ") || "هیچ برنامه‌ای"}
          </p>
          <div className="overflow-auto">
            <table className="w-full text-start">
              <caption>تعداد واقعی رکوردها</caption>
              <thead>
                <tr>
                  <th>دسته / جدول</th>
                  <th>حذف</th>
                  <th>حفظ</th>
                </tr>
              </thead>
              <tbody>
                {preview.plan.tables.map((t) => (
                  <tr key={`${t.table}-${t.category}`}>
                    <td>
                      {RESET_CATEGORIES[t.category].label} /{" "}
                      <span dir="ltr">{t.table}</span>
                    </td>
                    <td>{faNumber(t.remove)}</td>
                    <td>{faNumber(t.preserve)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {preview.plan.automatic.map((a) => (
            <p key={a.category}>
              وابستگی لازم: {RESET_CATEGORIES[a.category].label} —{" "}
              {a.reasons.join("، ")}
            </p>
          ))}
          {preview.plan.blockers.map((b) => (
            <p key={b} role="alert">
              مانع اجرا: {resetMessage(b)}
            </p>
          ))}
          {preview.plan.warnings.map((w) => (
            <p key={w}>هشدار: {resetMessage(w)}</p>
          ))}
          <p>
            نیازمند ایجاد مجدد:{" "}
            {preview.plan.recreation
              .map((c) => RESET_CATEGORIES[c].label)
              .join("، ") || "هیچ داده پایه‌ای حذف نمی‌شود"}
          </p>
          {preview.plan.recreation.map((c) => (
            <p key={c} role="note">
              پس از حذف {RESET_CATEGORIES[c].label}:{" "}
              {RESET_CATEGORIES[c].description}
            </p>
          ))}
          <Button
            variant="destructive"
            disabled={pending || !preview.plan.permitted}
            onClick={() => setConfirm(true)}
          >
            تأیید و اجرای بازنشانی
          </Button>
          <p>
            {preview.plan.permitted
              ? "اعتبارسنجی موفق؛ اجرا فقط پس از تأیید صریح و بررسی دوباره زیر قفل انجام می‌شود."
              : "اجرای این انتخاب مجاز نیست."}
          </p>
        </section>
      )}
      <Dialog
        preventClose={pending}
        open={confirm && preview !== null}
        onClose={() => {
          if (!pending) setConfirm(false);
        }}
        title="حذف داده‌های پیش‌نمایش؟"
        description="حذف دائمی است؛ برنامه‌های تأییدشده منتخب و تاریخچه نیز حذف می‌شوند."
      >
        {preview && (
          <div className="flex flex-col gap-3">
            <p>
              دامنه:{" "}
              {preview.selection.scope.kind === "APPLICATION"
                ? "همه سامانه"
                : departments
                    .filter((d) => preview.affectedDepartmentIds.includes(d.id))
                    .map((d) => d.name)
                    .join("، ")}
            </p>
            <p>
              {faNumber(preview.plan.tables.reduce((n, t) => n + t.remove, 0))}{" "}
              رکورد حذف می‌شود. مدیر محافظت‌شده و سابقه بازنشانی باقی می‌مانند.
            </p>
            <p>
              دسته‌ها:{" "}
              {[
                ...preview.plan.selected,
                ...preview.plan.automatic.map((a) => a.category),
              ]
                .map((c) => RESET_CATEGORIES[c].label)
                .join("، ")}
            </p>
            {preview.plan.recreation.map((c) => (
              <p key={c}>
                {RESET_CATEGORIES[c].label}: {RESET_CATEGORIES[c].description}
              </p>
            ))}
            {error && <p role="alert">{error}</p>}
            <div className="flex gap-2">
              <Button
                autoFocus
                variant="outline"
                disabled={pending}
                onClick={() => setConfirm(false)}
              >
                انصراف
              </Button>
              <Button
                variant="destructive"
                disabled={pending || !preview.plan.permitted}
                onClick={() =>
                  start(async () => {
                    setError(null);
                    const result = await executeFullResetAction({
                      selection: preview.selection,
                      previewId: preview.previewId,
                      issuedAt: preview.issuedAt,
                      fingerprint: preview.fingerprint,
                      proof: preview.proof,
                      confirmed: true,
                    });
                    if (result.ok) {
                      setConfirm(false);
                      setPreview(null);
                      setDepartmentIds([]);
                      setCompleted(true);
                    } else {
                      setError(
                        result.error.code === "CONFLICT"
                          ? "داده تغییر کرده یا نویسنده‌ای فعال است؛ پیش‌نمایش تازه بگیرید."
                          : "بازنشانی انجام نشد؛ هیچ حذف ناقصی ثبت نشد.",
                      );
                      setConfirm(false);
                      setPreview(null);
                    }
                  })
                }
              >
                {pending ? "در حال حذف…" : "حذف داده‌های انتخاب‌شده"}
              </Button>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}
