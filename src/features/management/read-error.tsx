"use client";

import { TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

export function ReadError({ retry }: { retry: () => void }) {
  return (
    <div role="alert">
      <EmptyState
        icon={<TriangleAlert aria-hidden="true" />}
        headingLevel={1}
        tone="danger"
        title="بارگذاری اطلاعات ممکن نشد"
        description="خواندن اطلاعات با خطا روبه‌رو شد. دوباره تلاش کنید."
        action={<Button onClick={retry}>تلاش دوباره</Button>}
      />
    </div>
  );
}
