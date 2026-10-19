"use client";

import type { Route } from "next";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

import { Dialog } from "@/components/ui/dialog";

/** URL-backed, read-only detail; native dialog contains focus and handles Escape. */
export function WorkforcePersonDialog({
  title,
  closeHref,
  personId,
  children,
}: {
  title: string;
  closeHref: Route;
  personId: string;
  children: ReactNode;
}) {
  const router = useRouter();
  return (
    <Dialog
      open
      title={title}
      focusTitle
      stickyHeader
      closeLabel="بستن جزئیات پرسنل"
      onClose={() => {
        router.replace(closeHref, { scroll: false });
        const triggers = document.querySelectorAll<HTMLElement>(
          `[data-workforce-person="${personId}"]`,
        );
        const trigger = [...triggers].find(
          (element) => element.getClientRects().length > 0,
        );
        (trigger ?? document.getElementById("workforce-search"))?.focus();
      }}
      className="max-h-[90dvh] sm:w-[min(calc(100vw-4rem),48rem)]"
    >
      {children}
    </Dialog>
  );
}
