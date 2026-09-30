import type { ComponentType, ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * An information block inside the page flow: a soft tinted surface, a
 * semantic icon and the text. `info` explains, `attention` warns about
 * something to review, `muted` states a limit (locked, read-only), `review`
 * and `success` state where the approval workflow stands. The icon
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
  /** With the Supervisor (SUBMITTED): the lifecycle's review violet (D56). */
  review: {
    box: "border-status-review/30 bg-status-review/8",
    icon: "text-status-review-foreground",
  },
  /** Approved: the only place a callout is green, like the APPROVED badge. */
  success: {
    box: "border-status-success/35 bg-status-success/8",
    icon: "text-status-success-foreground",
  },
} as const;

export function Callout({
  tone = "info",
  icon: Icon,
  as: Element = "p",
  children,
  className,
  ...props
}: {
  tone?: keyof typeof CALLOUT_TONES;
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  /** `div` when the content has block elements (a heading, a list). */
  as?: "p" | "div";
  children: ReactNode;
  className?: string;
  role?: "note" | "status";
  id?: string;
  "data-health"?: string;
  "data-workflow"?: string;
}) {
  const t = CALLOUT_TONES[tone];
  const Content = Element === "p" ? "span" : "div";
  return (
    <Element
      className={cn(
        "flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm leading-relaxed",
        t.box,
        className,
      )}
      {...props}
    >
      <Icon aria-hidden className={cn("mt-0.5 size-4 shrink-0", t.icon)} />
      <Content className={cn("min-w-0", Element === "div" && "flex-1")}>
        {children}
      </Content>
    </Element>
  );
}
