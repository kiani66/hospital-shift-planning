"use client";

import type { Route } from "next";
import Link from "next/link";

import { cn } from "@/lib/utils";

import {
  CALENDAR_VIEW_COOKIE,
  type CalendarView,
} from "./dashboard-navigation";

export function CalendarViewSwitch({
  view,
  weekHref,
  monthHref,
}: {
  view: CalendarView;
  weekHref: Route;
  monthHref: Route;
}) {
  return (
    <nav
      aria-label="نمای تقویم"
      className="flex flex-wrap gap-1 self-start rounded-lg border bg-card p-1"
    >
      {(
        [
          ["week", "هفتگی", weekHref],
          ["month", "ماهانه", monthHref],
        ] as const
      ).map(([value, label, href]) => (
        <Link
          key={value}
          href={href}
          scroll={false}
          aria-current={view === value ? "page" : undefined}
          onClick={() => {
            try {
              document.cookie = `${CALENDAR_VIEW_COOKIE}=${value}; Path=/my-shifts; Max-Age=31536000; SameSite=Lax`;
            } catch {
              /* Explicit URL still works when storage is blocked. */
            }
          }}
          className={cn(
            "inline-flex min-h-11 items-center justify-center rounded-md px-5 text-sm font-medium focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-none",
            view === value
              ? "bg-primary text-primary-foreground"
              : "hover:bg-accent",
          )}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
