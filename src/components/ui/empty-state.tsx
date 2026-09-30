import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * A state with nothing to show yet: what it is, what happens next, and the
 * action that moves on (when the viewer has one). Never a dead end without
 * an explanation.
 */
export function EmptyState({
  icon,
  title,
  titleId,
  headingLevel = 2,
  description,
  action,
  className,
}: {
  icon: ReactNode;
  title: ReactNode;
  titleId?: string;
  headingLevel?: 1 | 2 | 3 | null;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  const Title = headingLevel ? (`h${headingLevel}` as const) : "p";
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-3 rounded-lg border border-dashed px-6 py-10 text-center sm:py-14",
        className,
      )}
    >
      <span className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground [&>svg]:size-6">
        {icon}
      </span>
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
