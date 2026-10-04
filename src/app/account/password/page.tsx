import { KeyRound, LogOut } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { buttonClasses } from "@/components/ui/button";
import { IconWell } from "@/components/ui/icon-well";
import { logoutAction } from "@/features/auth/actions";
import { requirePasswordChangeContext } from "@/features/auth/guards";
import { PasswordChangeForm } from "@/features/auth/password-form";

export const metadata: Metadata = { title: "تغییر رمز عبور" };

/**
 * Self-service password change. Outside the app shell on purpose: a user
 * holding a temporary password reaches only this page (every other page and
 * action redirects here), so it must not depend on the shell's actor.
 */
export default async function PasswordPage() {
  const { forced } = await requirePasswordChangeContext();
  return (
    <main className="flex min-h-dvh items-start justify-center bg-canvas px-4 py-10 sm:items-center">
      <section
        aria-labelledby="password-title"
        className="relative w-full max-w-md overflow-hidden rounded-2xl border bg-card shadow-lg shadow-sidebar/8"
      >
        <span
          aria-hidden="true"
          className="absolute inset-x-0 top-0 h-1 bg-primary"
        />
        <div className="flex flex-col gap-6 p-6 pt-7 sm:p-8 sm:pt-9">
          <div className="flex items-start gap-3">
            <IconWell size="md">
              <KeyRound />
            </IconWell>
            <div className="flex flex-col gap-1">
              <h1
                id="password-title"
                className="text-xl leading-snug font-bold"
              >
                {forced ? "انتخاب رمز عبور شخصی" : "تغییر رمز عبور"}
              </h1>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {forced
                  ? "با رمز موقتی که دریافت کرده‌اید وارد شده‌اید. پیش از استفاده از سامانه، یک رمز عبور شخصی انتخاب کنید."
                  : "پس از تغییر رمز، همه نشست‌های دیگر شما در سایر دستگاه‌ها بسته می‌شوند."}
              </p>
            </div>
          </div>
          <PasswordChangeForm forced={forced} />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t bg-muted/60 px-6 py-3 sm:px-8">
          {forced ? (
            <span className="text-xs text-muted-foreground">
              تا انتخاب رمز جدید، دسترسی به سایر بخش‌ها ممکن نیست.
            </span>
          ) : (
            <Link href="/" className={buttonClasses("ghost")}>
              بازگشت
            </Link>
          )}
          <form action={logoutAction}>
            <button type="submit" className={buttonClasses("ghost")}>
              <LogOut aria-hidden="true" className="size-4 rtl:-scale-x-100" />
              خروج
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}
