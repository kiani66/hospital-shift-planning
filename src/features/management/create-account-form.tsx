"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useId, useState } from "react";

import { Button, buttonClasses } from "@/components/ui/button";

import { createAccountAction } from "./actions";
import { FormFeedback, ManagementInput } from "./form-fields";
import { OneTimePassword } from "./identity-controls";
import type { ManagementFormState } from "./mutation-result";

export function CreateAccountForm() {
  const router = useRouter();
  const [personnelNumber, setPersonnelNumber] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [mobile, setMobile] = useState("");
  const [issue, setIssue] = useState(true);
  const [issued, setIssued] = useState<{
    userId: string;
    password: string;
  } | null>(null);
  const checkboxId = useId();
  const [state, formAction, pending] = useActionState(
    async (
      previous: ManagementFormState,
      form: FormData,
    ): Promise<ManagementFormState> => {
      const next = await createAccountAction(previous, form);
      if (next.status === "success" && next.userId) {
        // A temporary password is shown here once; navigating away would lose it.
        if (next.temporaryPassword)
          setIssued({ userId: next.userId, password: next.temporaryPassword });
        else router.push(`/admin/personnel/${next.userId}`);
      }
      // Never keep the one-time password in the form state.
      return { ...next, temporaryPassword: undefined };
    },
    { status: "idle" },
  );

  if (issued)
    return (
      <div className="max-w-xl space-y-4 rounded-xl border bg-card p-5">
        <p role="status" className="text-sm">
          حساب ایجاد شد. کاربر با شماره پرسنلی و رمز موقت زیر وارد می‌شود و باید
          بلافاصله رمز شخصی انتخاب کند.
        </p>
        <OneTimePassword
          password={issued.password}
          onDone={() => router.push(`/admin/personnel/${issued.userId}`)}
        />
        <Link
          href={`/admin/personnel/${issued.userId}`}
          className={buttonClasses("outline")}
        >
          رفتن به صفحه کاربر (رمز دیگر نمایش داده نمی‌شود)
        </Link>
      </div>
    );

  return (
    <form
      action={formAction}
      noValidate
      aria-label="ایجاد حساب کاربر"
      className="max-w-xl space-y-5 rounded-xl border bg-card p-5"
    >
      <fieldset disabled={pending} className="space-y-4">
        <ManagementInput
          name="personnelNumber"
          label="شماره پرسنلی"
          value={personnelNumber}
          onChange={setPersonnelNumber}
          maxLength={40}
          dir="ltr"
          inputMode="numeric"
          required
          hint="الزامی؛ فقط رقم (۱ تا ۲۰ رقم). صفرهای ابتدایی حفظ می‌شوند. شناسه ورود کاربر است."
          error={state.fields?.personnelNumber}
          autoComplete="off"
        />
        <ManagementInput
          name="displayName"
          label="نام و نام خانوادگی"
          value={name}
          onChange={setName}
          maxLength={200}
          required
          error={state.fields?.displayName}
          autoComplete="off"
        />
        <ManagementInput
          name="email"
          label="ایمیل (اختیاری)"
          type="email"
          dir="ltr"
          value={email}
          onChange={setEmail}
          maxLength={320}
          hint="در صورت ثبت، ورود با ایمیل هم ممکن است."
          error={state.fields?.email}
          autoComplete="off"
        />
        <ManagementInput
          name="mobile"
          label="شماره موبایل (اختیاری)"
          type="tel"
          dir="ltr"
          inputMode="tel"
          value={mobile}
          onChange={setMobile}
          maxLength={40}
          hint="مثلاً ۰۹۱۲۱۲۳۴۵۶۷. شناسه ورود نیست."
          error={state.fields?.mobile}
          autoComplete="off"
        />
        <div className="flex items-start gap-3 rounded-lg border p-3">
          <input
            id={checkboxId}
            type="checkbox"
            name="issueTemporaryPassword"
            checked={issue}
            onChange={(event) => setIssue(event.target.checked)}
            className="mt-1 size-4 accent-primary"
          />
          <label htmlFor={checkboxId} className="text-sm leading-relaxed">
            همین حالا رمز موقت ساخته شود
            <span className="block text-xs text-muted-foreground">
              رمز تصادفی فقط یک بار نمایش داده می‌شود. بدون رمز، حساب تا ساخت
              رمز موقت از صفحه کاربر امکان ورود ندارد.
            </span>
          </label>
        </div>
      </fieldset>
      <FormFeedback state={state} />
      <Button type="submit" disabled={pending}>
        {pending ? "در حال ایجاد…" : "ایجاد حساب"}
      </Button>
    </form>
  );
}
