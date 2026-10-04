"use client";

import { CircleAlert, KeyRound, LoaderCircle } from "lucide-react";
import { useActionState, useRef } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import {
  changePasswordAction,
  type PasswordChangeState,
} from "./password-actions";

const MESSAGES: Record<NonNullable<PasswordChangeState["error"]>, string> = {
  invalidCurrent: "رمز عبور فعلی نادرست است.",
  throttled:
    "به دلیل تلاش‌های ناموفق متعدد، این حساب موقتاً مسدود شده است. لطفاً ۱۵ دقیقه دیگر دوباره تلاش کنید.",
  length: "رمز عبور جدید باید بین ۱۲ تا ۲۵۶ نویسه باشد.",
  mismatch: "تکرار رمز عبور جدید با خود آن یکسان نیست.",
  unchanged: "رمز عبور جدید باید با رمز فعلی متفاوت باشد.",
  failed: "تغییر رمز عبور ممکن نشد. دوباره تلاش کنید.",
};

export function PasswordChangeForm({ forced }: { forced: boolean }) {
  const form = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState(
    async (previous: PasswordChangeState, data: FormData) => {
      // FormData is captured; clear the secrets from the page immediately.
      form.current?.reset();
      return changePasswordAction(previous, data);
    },
    {},
  );
  const error = state.error ? MESSAGES[state.error] : null;
  const invalid = error ? true : undefined;
  const describedBy = error ? "password-error" : undefined;

  return (
    <form ref={form} action={action} className="flex flex-col gap-5">
      <div
        id="password-error"
        role="alert"
        aria-live="assertive"
        className={
          error
            ? "flex items-start gap-2 rounded-lg border border-destructive/35 bg-destructive/5 px-3 py-2.5 text-sm leading-relaxed text-destructive"
            : "sr-only"
        }
      >
        {error && (
          <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        )}
        {error}
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="currentPassword">
          {forced ? "رمز موقت فعلی" : "رمز عبور فعلی"}
        </Label>
        <Input
          id="currentPassword"
          name="currentPassword"
          type="password"
          dir="ltr"
          autoComplete="current-password"
          required
          maxLength={256}
          aria-invalid={invalid}
          aria-describedby={describedBy}
          className="min-h-12 text-start"
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="newPassword">رمز عبور جدید</Label>
        <Input
          id="newPassword"
          name="newPassword"
          type="password"
          dir="ltr"
          autoComplete="new-password"
          required
          minLength={12}
          maxLength={256}
          aria-invalid={invalid}
          aria-describedby={`new-password-help${describedBy ? ` ${describedBy}` : ""}`}
          className="min-h-12 text-start"
        />
        <p id="new-password-help" className="text-xs text-muted-foreground">
          حداقل ۱۲ نویسه؛ متفاوت با رمز فعلی. یک عبارت بلند و به‌یادماندنی
          انتخاب کنید.
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="confirmation">تکرار رمز عبور جدید</Label>
        <Input
          id="confirmation"
          name="confirmation"
          type="password"
          dir="ltr"
          autoComplete="new-password"
          required
          maxLength={256}
          aria-invalid={invalid}
          aria-describedby={describedBy}
          className="min-h-12 text-start"
        />
      </div>
      <Button
        type="submit"
        disabled={pending}
        aria-disabled={pending}
        className="mt-1 min-h-12 text-base font-semibold"
      >
        {pending ? (
          <LoaderCircle
            aria-hidden="true"
            className="size-5 motion-safe:animate-spin"
          />
        ) : (
          <KeyRound aria-hidden="true" className="size-5" />
        )}
        {pending ? "در حال ذخیره…" : "ذخیره رمز عبور جدید"}
      </Button>
    </form>
  );
}
