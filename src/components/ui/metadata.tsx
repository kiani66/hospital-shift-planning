import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/** Term / value pairs as a `dl`: quiet terms, the values carry the weight. */
export function MetadataList({
  items,
  className,
}: {
  items: readonly (readonly [string, ReactNode])[];
  className?: string;
}) {
  return (
    <dl
      className={cn(
        "grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm",
        className,
      )}
    >
      {items.map(([term, value]) => (
        <div key={term} className="contents">
          <dt className="text-muted-foreground">{term}</dt>
          <dd className="min-w-0 font-medium break-words">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
