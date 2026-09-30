"use client";

import { RotateCw, TriangleAlert } from "lucide-react";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

/**
 * The schedule could not be loaded (a server or connection failure; a
 * denied or unknown department is a 404, not this). Says what happened in
 * Persian, never the error itself, and offers to try again; nothing was
 * changed by a failed read.
 */
export default function ScheduleError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div role="alert">
      <EmptyState
        icon={<TriangleAlert aria-hidden="true" />}
        headingLevel={1}
        tone="danger"
        title="بارگذاری برنامه ممکن نشد"
        description="ارتباط با سرور یا خواندن برنامه با خطا روبه‌رو شد. تغییری از دست نرفته است؛ دوباره تلاش کنید."
        action={
          <Button onClick={() => retry()}>
            <RotateCw aria-hidden="true" className="size-4" />
            تلاش دوباره
          </Button>
        }
      />
    </div>
  );
}
