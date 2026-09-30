import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * The heading row of a page section: an icon, the title (the section's
 * accessible name through `id`), optional quiet metadata and actions at the
 * end. One weight for every section, so titles never compete with data.
 */
export function SectionHeader({
  id,
  title,
  icon,
  meta,
  actions,
  level = 2,
  className,
}: {
  id: string;
  title: ReactNode;
  icon?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  level?: 2 | 3;
  className?: string;
}) {
  const Heading = level === 2 ? "h2" : "h3";
  return (
    <div
      className={cn("flex flex-wrap items-center gap-x-3 gap-y-2", className)}
    >
      <Heading
        id={id}
        className="flex min-w-0 items-center gap-2 text-base font-semibold"
      >
        {icon}
        {title}
      </Heading>
      {meta && (
        <span className="text-sm text-muted-foreground tabular-nums">
          {meta}
        </span>
      )}
      {actions && (
        <div className="ms-auto flex items-center gap-2">{actions}</div>
      )}
    </div>
  );
}
