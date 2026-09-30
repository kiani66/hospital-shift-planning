"use client";

import { ChevronLeft, ChevronRight, LoaderCircle } from "lucide-react";
import type { Route } from "next";
import Link, { useLinkStatus } from "next/link";

import { cn } from "@/lib/utils";

export interface DayLink {
  readonly href: Route;
  /** "یکشنبه ۳ آبان ۱۴۰۵" */
  readonly label: string;
}

const base =
  "inline-flex size-11 shrink-0 items-center justify-center rounded-md border border-input focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-none md:size-9 pointer-coarse:size-11";

function Pending({ icon: Icon }: { icon: typeof ChevronLeft }) {
  const { pending } = useLinkStatus();
  return pending ? (
    <LoaderCircle
      aria-hidden="true"
      className="size-5 text-muted-foreground motion-safe:animate-spin"
    />
  ) : (
    <Icon aria-hidden="true" className="size-5" />
  );
}

function DayNavLink({
  direction,
  target,
}: {
  direction: "previous" | "next";
  target: DayLink | null;
}) {
  // RTL: the earlier day is at the start (right), so it points right.
  const Icon = direction === "previous" ? ChevronRight : ChevronLeft;
  const text = direction === "previous" ? "روز قبل" : "روز بعد";
  if (!target)
    return (
      <button
        type="button"
        disabled
        aria-label={`${text} (خارج از دوره برنامه)`}
        className={cn(base, "cursor-not-allowed opacity-40")}
      >
        <Icon aria-hidden="true" className="size-5" />
      </button>
    );
  return (
    <Link
      href={target.href}
      replace
      scroll={false}
      prefetch={false}
      aria-label={`${text}: ${target.label}`}
      title={target.label}
      className={cn(
        base,
        "bg-background shadow-xs transition-colors hover:border-primary/40 hover:bg-accent hover:text-accent-foreground",
      )}
    >
      <Pending icon={Icon} />
    </Link>
  );
}

/**
 * Previous / next day inside the open day, in chronological order and
 * within the schedule period (the calendar's month navigation is separate).
 * The day stays open while the next one loads, so consecutive days are
 * reviewed and edited without closing and reopening.
 */
export function DayNav({
  previous,
  next,
}: {
  previous: DayLink | null;
  next: DayLink | null;
}) {
  return (
    <nav aria-label="روزهای برنامه" className="flex items-center gap-1">
      <DayNavLink direction="previous" target={previous} />
      <DayNavLink direction="next" target={next} />
    </nav>
  );
}
