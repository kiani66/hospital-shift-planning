import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * The tinted square an icon sits in, for section and state headings. One
 * tone per meaning (the brand for ordinary sections, attention for a
 * section about problems, danger for failures), so color in headings stays
 * coordinated instead of decorative. The icon itself is decorative.
 */
export const ICON_WELL_TONES = {
  brand: "bg-brand-soft text-primary",
  attention: "bg-health-attention/15 text-health-attention-foreground",
  danger: "bg-destructive/10 text-destructive",
  muted: "bg-muted text-muted-foreground",
} as const;

const SIZES = {
  sm: "size-7 rounded-md [&>svg]:size-4",
  md: "size-9 rounded-lg [&>svg]:size-5",
  lg: "size-12 rounded-xl [&>svg]:size-6",
} as const;

export function IconWell({
  tone = "brand",
  size = "sm",
  children,
  className,
}: {
  tone?: keyof typeof ICON_WELL_TONES;
  size?: keyof typeof SIZES;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex shrink-0 items-center justify-center [&>svg]:shrink-0 [&>svg]:text-current",
        SIZES[size],
        ICON_WELL_TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
