import Link from "next/link";

import { buttonClasses } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-xl font-bold">صفحه پیدا نشد</h1>
      <p className="text-muted-foreground">
        این صفحه وجود ندارد یا به آن دسترسی ندارید.
      </p>
      <Link href="/" className={buttonClasses("outline")}>
        بازگشت به صفحه اصلی
      </Link>
    </main>
  );
}
