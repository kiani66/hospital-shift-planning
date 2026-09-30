"use client";

import { LoaderCircle } from "lucide-react";
import { useLinkStatus } from "next/link";

/**
 * Inside a `Link`: a small spinner while that link's navigation is pending
 * (opening a day is a server render), so a slow connection still gets an
 * immediate answer to the click. Renders nothing otherwise; one tiny client
 * island per link, no client calendar.
 */
export function LinkPending({ className }: { className?: string }) {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return (
    <LoaderCircle
      aria-hidden="true"
      className={
        className ??
        "absolute end-1 bottom-1 size-4 text-muted-foreground motion-safe:animate-spin"
      }
    />
  );
}
