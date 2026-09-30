"use client";

import type { Route } from "next";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

import { Dialog } from "@/components/ui/dialog";

/**
 * Hosts the Day Detail. It is open because the URL has `?day=`: closing it
 * (button, Escape, backdrop) replaces the URL without it and returns focus
 * to the day's calendar cell. Large modal on desktop, full screen on phones.
 */
export function DayDetailDialog({
  title,
  description,
  closeHref,
  returnFocusId,
  children,
}: {
  title: ReactNode;
  description: ReactNode;
  closeHref: Route;
  returnFocusId: string;
  children: ReactNode;
}) {
  const router = useRouter();
  return (
    <Dialog
      open
      onClose={() => {
        router.replace(closeHref, { scroll: false });
        document.getElementById(returnFocusId)?.focus();
      }}
      title={title}
      description={description}
      closeLabel="بستن جزئیات روز"
      className="max-sm:m-0 max-sm:h-dvh max-sm:max-h-none max-sm:w-full max-sm:max-w-none max-sm:rounded-none max-sm:border-0 sm:w-[min(calc(100vw-4rem),64rem)]"
    >
      {children}
    </Dialog>
  );
}
