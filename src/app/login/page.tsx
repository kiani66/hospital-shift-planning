import { Hospital } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { LoginForm } from "@/features/auth/login-form";
import { safeRedirectPath } from "@/features/auth/safe-redirect";
import { getActor } from "@/infrastructure/auth/session";

export const metadata: Metadata = { title: "ورود" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  // Already signed in with a still-valid, active account: skip the form.
  if (await getActor()) redirect("/");
  const { callbackUrl } = await searchParams;

  return (
    <main className="flex min-h-dvh items-center justify-center bg-muted/40 px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <span className="flex size-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Hospital aria-hidden="true" className="size-7" />
          </span>
          <p className="text-sm text-muted-foreground">
            سامانه برنامه‌ریزی شیفت پرستاران
          </p>
        </div>
        <section
          aria-labelledby="login-title"
          className="rounded-xl border bg-card p-6 shadow-sm sm:p-8"
        >
          <h1 id="login-title" className="mb-6 text-xl font-bold">
            ورود به سامانه
          </h1>
          <LoginForm callbackUrl={safeRedirectPath(callbackUrl)} />
        </section>
        <p className="mt-6 text-center text-xs leading-relaxed text-muted-foreground">
          حساب‌های کاربری توسط مدیر سامانه ایجاد می‌شوند. در صورت مشکل در ورود
          با واحد فناوری اطلاعات بیمارستان تماس بگیرید.
        </p>
      </div>
    </main>
  );
}
