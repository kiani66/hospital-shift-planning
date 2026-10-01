"use client";

import type { Route } from "next";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

import { Dialog } from "@/components/ui/dialog";

/**
 * Hosts one request's detail. It is open because the URL has `?request=`:
 * closing it (button, Escape, backdrop) goes back to the queue. Large modal
 * on desktop, full screen on phones; focus starts on the title.
 */
export function RequestReviewDialog({
  title,
  closeHref,
  children,
}: {
  title: ReactNode;
  closeHref: Route;
  children: ReactNode;
}) {
  const router = useRouter();
  return (
    <Dialog
      open
      onClose={() => router.replace(closeHref, { scroll: false })}
      title={title}
      closeLabel="بستن جزئیات درخواست"
      stickyHeader
      focusTitle
      className="max-sm:m-0 max-sm:h-dvh max-sm:max-h-none max-sm:w-full max-sm:max-w-none max-sm:rounded-none max-sm:border-0 sm:w-[min(calc(100vw-4rem),64rem)]"
    >
      {children}
    </Dialog>
  );
}
