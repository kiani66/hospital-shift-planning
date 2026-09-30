import type { ComponentType, ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Semantic tones. Each maps to design tokens of `globals.css`, never to a
 * literal palette color, and a badge always carries text (and usually an
 * icon), so its meaning never depends on color alone.
 */
export const BADGE_TONES = {
  neutral: "border-border bg-background text-foreground",
  muted: "border-transparent bg-muted text-muted-foreground",
  valid:
    "border-health-valid/40 bg-health-valid/10 text-health-valid-foreground",
  attention:
    "border-health-attention/50 bg-health-attention/10 text-health-attention-foreground",
  unplanned:
    "border-health-unplanned/40 bg-health-unplanned/10 text-health-unplanned-foreground",
  holiday: "border-holiday/40 bg-holiday/10 text-holiday-foreground",
  active:
    "border-status-active/40 bg-status-active/10 text-status-active-foreground",
  destructive: "border-destructive/40 bg-destructive/5 text-destructive",
} as const;

export type BadgeTone = keyof typeof BADGE_TONES;

const SIZES = {
  sm: "gap-1 px-2 py-0.5 text-xs [&>svg]:size-3.5",
  md: "gap-1.5 px-2.5 py-1 text-xs [&>svg]:size-3.5",
} as const;

/** A compact status pill: icon + text in one semantic tone. */
export function Badge({
  tone = "neutral",
  size = "md",
  icon: Icon,
  children,
  className,
}: {
  tone?: BadgeTone;
  size?: keyof typeof SIZES;
  icon?: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full border font-medium whitespace-nowrap",
        SIZES[size],
        BADGE_TONES[tone],
        className,
      )}
    >
      {Icon && <Icon aria-hidden className="shrink-0" />}
      {children}
    </span>
  );
}
