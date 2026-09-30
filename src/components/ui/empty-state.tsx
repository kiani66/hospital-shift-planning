import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

import { IconWell } from "./icon-well";

/**
 * A state with nothing to show yet: what it is, what happens next, and the
 * action that moves on (when the viewer has one). Never a dead end without
 * an explanation. A soft brand tint (or the danger tint for a failure) and
 * an icon well; no illustration.
 */
export function EmptyState({
  icon,
  title,
  titleId,
  headingLevel = 2,
  description,
  action,
  tone = "brand",
  className,
}: {
  icon: ReactNode;
  title: ReactNode;
  titleId?: string;
  headingLevel?: 1 | 2 | 3 | null;
  description?: ReactNode;
  action?: ReactNode;
  tone?: "brand" | "danger";
  className?: string;
}) {
  const Title = headingLevel ? (`h${headingLevel}` as const) : "p";
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-10 text-center sm:py-14",
        tone === "brand"
          ? "border-primary/25 bg-brand-soft/45"
          : "border-destructive/30 bg-destructive/5",
        className,
      )}
    >
      <IconWell
        tone={tone}
        size="lg"
        className={cn(
          "bg-background shadow-xs ring-1",
          tone === "brand" ? "ring-primary/15" : "ring-destructive/20",
        )}
      >
        {icon}
      </IconWell>
      <Title id={titleId} className="text-lg font-semibold text-balance">
        {title}
      </Title>
      {description && (
        <div className="max-w-md text-sm leading-relaxed text-pretty text-muted-foreground">
          {description}
        </div>
      )}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
