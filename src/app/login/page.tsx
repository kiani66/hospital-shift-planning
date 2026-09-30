import { Info, KeyRound } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { IconWell } from "@/components/ui/icon-well";
import { LoginBrandPanel } from "@/features/auth/login-brand-panel";
import { LoginForm } from "@/features/auth/login-form";
import { safeRedirectPath } from "@/features/auth/safe-redirect";
import { getActor } from "@/infrastructure/auth/session";

export const metadata: Metadata = { title: "ورود" };

/**
 * Split layout from `lg`: the navy brand panel at the inline start, the
 * form on the calm canvas beside it. Phones: a compact brand band with the
 * form card overlapping its lower edge.
 */
export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  // Already signed in with a still-valid, active account: skip the form.
  if (await getActor()) redirect("/");
  const { callbackUrl } = await searchParams;

  return (
    <main className="min-h-dvh bg-canvas lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <LoginBrandPanel />
      <div className="relative -mt-10 flex justify-center px-4 pb-10 lg:mt-0 lg:items-center lg:px-10 lg:py-12">
        <div className="w-full max-w-md">
          <section
            aria-labelledby="login-title"
            className="relative overflow-hidden rounded-2xl border bg-card shadow-lg shadow-sidebar/8"
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
                    id="login-title"
                    className="text-xl leading-snug font-bold"
                  >
                    ورود به سامانه
                  </h1>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    با ایمیل و رمز عبور حساب کاربری خود وارد شوید.
                  </p>
                </div>
              </div>
              <LoginForm callbackUrl={safeRedirectPath(callbackUrl)} />
            </div>
            <p className="flex items-start gap-2 border-t bg-muted/60 px-6 py-4 text-xs leading-relaxed text-muted-foreground sm:px-8">
              <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              <span>
                حساب‌های کاربری توسط مدیر سامانه ایجاد می‌شوند. در صورت مشکل در
                ورود با واحد فناوری اطلاعات بیمارستان تماس بگیرید.
              </span>
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}
