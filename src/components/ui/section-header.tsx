import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

import { IconWell, type ICON_WELL_TONES } from "./icon-well";

/**
 * The heading row of a page section: an icon in a tinted well, the title
 * (the section's accessible name through `id`), optional quiet metadata and
 * actions at the end. One weight for every section, so titles never compete
 * with data; the well is the section's one touch of brand color.
 */
export function SectionHeader({
  id,
  title,
  icon,
  meta,
  actions,
  level = 2,
  tone = "brand",
  className,
}: {
  id: string;
  title: ReactNode;
  icon?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  level?: 2 | 3;
  tone?: keyof typeof ICON_WELL_TONES;
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
        {icon && <IconWell tone={tone}>{icon}</IconWell>}
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
