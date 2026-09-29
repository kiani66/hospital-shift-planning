import Link from "next/link";

import { buttonClasses } from "@/components/ui/button";

/** Also the answer to a denied department URL, so it never reveals that the department exists. */
export default function AppNotFound() {
  return (
    <div className="flex flex-col items-start gap-4">
      <h1 className="text-xl font-bold">صفحه پیدا نشد</h1>
      <p className="text-muted-foreground">
        این صفحه وجود ندارد یا به آن دسترسی ندارید.
      </p>
      <Link href="/" className={buttonClasses("outline")}>
        بازگشت به صفحه اصلی
      </Link>
    </div>
  );
}
