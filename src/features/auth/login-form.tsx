"use client";

import { CircleAlert, LoaderCircle, LogIn } from "lucide-react";
import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { loginAction, type LoginState } from "./actions";

const MESSAGES = {
  invalid: "شماره پرسنلی/ایمیل یا رمز عبور نادرست است.",
  throttled:
    "به دلیل تلاش‌های ناموفق متعدد، ورود به این حساب موقتاً مسدود شده است. لطفاً ۱۵ دقیقه دیگر دوباره تلاش کنید.",
} as const;

export function LoginForm({ callbackUrl }: { callbackUrl: string }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(
    loginAction,
    {},
  );
  const error = state.error ? MESSAGES[state.error] : null;

  return (
    <form action={action} className="flex flex-col gap-5">
      <input type="hidden" name="callbackUrl" value={callbackUrl} />

      <div
        id="login-error"
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
        <Label htmlFor="identifier">شماره پرسنلی یا ایمیل</Label>
        <Input
          id="identifier"
          name="identifier"
          type="text"
          dir="ltr"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          maxLength={320}
          required
          defaultValue={state.identifier}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "login-error" : undefined}
          className="min-h-12 text-start"
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="password">رمز عبور</Label>
        <Input
          id="password"
          name="password"
          type="password"
          dir="ltr"
          autoComplete="current-password"
          required
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "login-error" : undefined}
          className="min-h-12 text-start"
        />
      </div>

      <Button
        type="submit"
        disabled={pending}
        aria-disabled={pending}
        className="mt-1 min-h-12 text-base font-semibold shadow-sm shadow-primary/25"
      >
        {pending ? (
          <LoaderCircle
            aria-hidden="true"
            className="size-5 motion-safe:animate-spin"
          />
        ) : (
          <LogIn aria-hidden="true" className="size-5 rtl:-scale-x-100" />
        )}
        {pending ? "در حال ورود…" : "ورود"}
      </Button>
    </form>
  );
}
