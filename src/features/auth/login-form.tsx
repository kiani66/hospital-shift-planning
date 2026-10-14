"use client";

import {
  CircleAlert,
  Eye,
  EyeOff,
  LoaderCircle,
  LockKeyhole,
  LogIn,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import {
  useActionState,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

import { loginAction, type LoginState } from "./actions";

const MESSAGES = {
  invalid: "شماره پرسنلی/ایمیل یا رمز عبور نادرست است.",
  throttled:
    "به دلیل تلاش‌های ناموفق متعدد، ورود به این حساب موقتاً مسدود شده است. لطفاً ۱۵ دقیقه دیگر دوباره تلاش کنید.",
} as const;

/**
 * A 48px login field with a decorative icon at the inline start (the right,
 * in the RTL page). The value itself is LTR (an e-mail, a number, a
 * password), so inside the input the icon's side is its *end*: `pe-11`
 * keeps the typed text clear of it. `trailing` sits at the opposite edge.
 */
function IconField({
  icon: Icon,
  trailing,
  className,
  ...props
}: ComponentProps<typeof Input> & {
  icon: LucideIcon;
  trailing?: ReactNode;
}) {
  return (
    <div className="group relative">
      <Icon
        aria-hidden="true"
        className="pointer-events-none absolute start-3.5 top-1/2 size-5 -translate-y-1/2 text-muted-foreground transition-colors group-focus-within:text-primary"
      />
      <Input
        dir="ltr"
        className={cn("min-h-12 pe-11 text-start", className)}
        {...props}
      />
      {trailing}
    </div>
  );
}

export function LoginForm({ callbackUrl }: { callbackUrl: string }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(
    loginAction,
    {},
  );
  const [showPassword, setShowPassword] = useState(false);
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
        <IconField
          icon={UserRound}
          id="identifier"
          name="identifier"
          type="text"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          maxLength={320}
          required
          defaultValue={state.identifier}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "login-error" : undefined}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="password">رمز عبور</Label>
        <IconField
          icon={LockKeyhole}
          id="password"
          name="password"
          type={showPassword ? "text" : "password"}
          autoComplete="current-password"
          required
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "login-error" : undefined}
          // The toggle sits at the inline end (the left, the LTR input's start).
          className="ps-12"
          trailing={
            <button
              type="button"
              onClick={() => setShowPassword((shown) => !shown)}
              aria-pressed={showPassword}
              aria-controls="password"
              aria-label="نمایش رمز"
              className="absolute end-1 top-1/2 inline-flex size-10 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              {showPassword ? (
                <EyeOff aria-hidden="true" className="size-5" />
              ) : (
                <Eye aria-hidden="true" className="size-5" />
              )}
            </button>
          }
        />
      </div>

      <Button
        type="submit"
        disabled={pending}
        aria-disabled={pending}
        className="mt-1 min-h-12 text-base font-semibold shadow-md shadow-primary/30 hover:shadow-lg hover:shadow-primary/30"
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
