import type { ComponentType, ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * An information block inside the page flow: a soft tinted surface, a
 * semantic icon and the text. `info` explains, `attention` warns about
 * something to review, `muted` states a limit (locked, read-only). The icon
 * and the wording carry the meaning; the tint only groups it.
 */
export const CALLOUT_TONES = {
  info: {
    box: "border-status-info/30 bg-status-info/8",
    icon: "text-status-info-foreground",
  },
  attention: {
    box: "border-health-attention/50 bg-health-attention/10",
    icon: "text-health-attention-foreground",
  },
  muted: {
    box: "border-border bg-muted/60 text-muted-foreground",
    icon: "text-muted-foreground",
  },
} as const;

export function Callout({
  tone = "info",
  icon: Icon,
  children,
  className,
  ...props
}: {
  tone?: keyof typeof CALLOUT_TONES;
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  children: ReactNode;
  className?: string;
  role?: "note" | "status";
  "data-health"?: string;
}) {
  const t = CALLOUT_TONES[tone];
  return (
    <p
      className={cn(
        "flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm leading-relaxed",
        t.box,
        className,
      )}
      {...props}
    >
      <Icon aria-hidden className={cn("mt-0.5 size-4 shrink-0", t.icon)} />
      <span className="min-w-0">{children}</span>
    </p>
  );
}
