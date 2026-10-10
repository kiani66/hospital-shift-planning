"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import type { MasterRecoveryPreview } from "@/application/reset/recovery";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import {
  previewMasterRecoveryAction,
  executeMasterRecoveryAction,
} from "./recovery-actions";

export function MasterRecoveryControl() {
  const [preview, setPreview] = useState<MasterRecoveryPreview | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <section
      aria-label="بازیابی داده پایه"
      className="mt-8 space-y-3 rounded-lg border p-4"
    >
      <h2 className="font-bold">بازیابی کنترل‌شده داده پایه</h2>
      <p>
        فقط تعریف‌های پیش‌فرض مفقود اضافه می‌شوند؛ تعریف سفارشی، دلیل غیرفعال،
        نسخه موجود، حساب و رمزها بازنویسی نمی‌شوند. بخش بیمارستان ساخته نمی‌شود.
      </p>
      <ol className="list-inside list-decimal space-y-2">
        <li>پیش‌نمایش زیر را بررسی و بازیابی تعریف‌های مفقود را تأیید کنید.</li>
        <li>
          برای بخش حذف‌شده، مسئول بیمارستان باید کد یکتا، نام واقعی و منطقه
          زمانی را تأیید کند. اپراتور پایگاه داده با رویه مستند «بازیابی بخش» در
          docs/phase-14-reset.md یک بخش فعال جدید می‌سازد؛ seed آزمایشی یا
          بازاجرای مهاجرت‌ها را اجرا نکنید. شناسه بخش حذف‌شده و تاریخچه آن
          بازگردانده نمی‌شود.
        </li>
        <li>
          در{" "}
          <Link href="/admin/personnel/import" className="underline">
            ورود CSV
          </Link>{" "}
          تعارض‌ها را رفع و پرسنل را وارد کنید؛ در پرونده پرسنل، عضویت جاری
          سرپرستار را برای بخش فعال ثبت کنید. رمز ورود فقط با ابزار صریح مدیریت
          رمز ساخته می‌شود.
        </li>
        <li>
          در{" "}
          <Link href="/admin/staffing-rules" className="underline">
            قوانین پوشش بیمارستان
          </Link>{" "}
          مقادیر تأییدشده را بررسی و منتشر کنید. قانون اختصاصی بخش، تعطیلات و
          استثناهای حذف‌شده خودکار بازیابی نمی‌شوند. تاریخ اثر باید ماه برنامه
          را پوشش دهد.
        </li>
        <li>
          سرپرستار همان بخش اکنون می‌تواند ماه جدید را ایجاد کند؛ فهرست ماهانه
          از عضویت معتبر ساخته می‌شود.
        </li>
      </ol>
      <Button
        disabled={pending}
        variant="outline"
        onClick={() =>
          start(async () => {
            setMessage(null);
            setPreview(null);
            const result = await previewMasterRecoveryAction();
            if (result.ok) setPreview(result.data);
            else
              setMessage(
                "پیش‌نمایش بازیابی در دسترس نیست؛ دسترسی مدیر را بررسی کنید.",
              );
          })
        }
      >
        پیش‌نمایش بازیابی داده پایه
      </Button>
      {message && <p role="status">{message}</p>}
      {preview && (
        <section aria-label="پیش‌نمایش بازیابی" className="space-y-2">
          <p>
            شیفت‌های اضافه‌شونده ({preview.plan.counts.shiftTypes}):{" "}
            {preview.plan.shiftCodes.join("، ") || "هیچ"}؛ دلایل اضافه‌شونده (
            {preview.plan.counts.changeReasons}):{" "}
            {preview.plan.reasonCodes.join("، ") || "هیچ"}
          </p>
          <p>
            تبار جدید: {preview.plan.counts.staffingRuleSets}؛ نسخه منتشرشده:{" "}
            {preview.plan.counts.staffingRuleSetVersions}؛ ردیف پوشش:{" "}
            {preview.plan.counts.staffingRequirements}؛ بخش جدید: 0
          </p>
          <p>
            حفظ تعریف‌های شیفت:{" "}
            {preview.plan.preservedShiftCodes.join("، ") || "هیچ"}؛ حفظ دلایل:{" "}
            {preview.plan.preservedReasonCodes.join("، ") || "هیچ"}؛ نسخه‌های
            موجود: {preview.plan.preservedStaffingVersions}؛ بخش‌های موجود:{" "}
            {preview.plan.departmentCount}
          </p>
          <p>
            تعریف‌های استاندارد: M صبح، E عصر، N شب، ME طولانی، OFF استراحت؛
            دلایل بیماری، فوریت خانوادگی، کار شخصی، آموزش، نیاز عملیاتی، تعادل
            بار کاری و سایر (با یادداشت الزامی). اگر کد موجود باشد، برچسب و
            تنظیم فعلی همان کد حفظ می‌شود.
          </p>
          {preview.plan.warnings.map((w) => (
            <p key={w}>{w}</p>
          ))}
          {preview.plan.blockers.map((b) => (
            <p role="alert" key={b}>
              {b}
            </p>
          ))}
          <Button
            disabled={pending || !preview.plan.permitted}
            onClick={() => setConfirm(true)}
          >
            تأیید بازیابی داده پایه
          </Button>
        </section>
      )}
      <Dialog
        open={confirm && preview !== null}
        preventClose={pending}
        onClose={() => {
          if (!pending) setConfirm(false);
        }}
        title="بازیابی تعریف‌های مفقود؟"
        description="فقط رکوردهای پیش‌نمایش اضافه می‌شوند؛ هیچ داده موجود بازنویسی نمی‌شود."
      >
        {preview && (
          <div className="space-y-3">
            <p>
              {Object.values(preview.plan.counts).reduce((n, c) => n + c, 0)}{" "}
              رکورد اضافه می‌شود. بخش و سیاست بالینی اختصاصی ساخته نمی‌شود.
            </p>
            {preview.plan.restoreBaseline && (
              <p>
                خط پایه پیشین: M/E/N حداقل یک نفر، بدون حداکثر، از 1900-01-01.
                نیاز واقعی بیمارستان را پیش از استفاده عملیاتی بررسی کنید.
              </p>
            )}
            <Button
              variant="outline"
              disabled={pending}
              onClick={() => setConfirm(false)}
            >
              انصراف
            </Button>
            <Button
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const result = await executeMasterRecoveryAction({
                    previewId: preview.previewId,
                    issuedAt: preview.issuedAt,
                    fingerprint: preview.fingerprint,
                    proof: preview.proof,
                    confirmed: true,
                  });
                  setConfirm(false);
                  setPreview(null);
                  setMessage(
                    result.ok
                      ? result.data.changed
                        ? "بازیابی انجام شد؛ داده‌های موجود حفظ شدند."
                        : "همه تعریف‌ها موجودند؛ هیچ تغییری لازم نبود."
                      : result.error.code === "CONFLICT"
                        ? "داده تغییر کرده یا نویسنده‌ای فعال است؛ پیش‌نمایش تازه بگیرید."
                        : "بازیابی انجام نشد؛ هیچ تغییر ناقصی ثبت نشد.",
                  );
                })
              }
            >
              {pending ? "در حال بازیابی…" : "افزودن تعریف‌های پیش‌نمایش"}
            </Button>
          </div>
        )}
      </Dialog>
    </section>
  );
}
