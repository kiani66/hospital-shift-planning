import { CircleDashed } from "lucide-react";

import { faNumber } from "@/features/calendar/jalali";
import { ShiftChip } from "@/features/shifts/shift-chip";
import { cn } from "@/lib/utils";

import {
  NO_PREFERENCE,
  PREFERENCE_OPTIONS,
  type PreferenceCounts,
} from "./presentation";

export const SUMMARY_HEADING_ID = "preference-summary";

/**
 * Days per preference in the month, and days without one. «بدون ترجیح» is
 * informational (preferences are optional): neutral, never a warning tone.
 * No hooks, so the editable (client) and read-only (server) views share it.
 */
export function PreferenceSummary({
  counts,
  className,
}: {
  counts: PreferenceCounts;
  className?: string;
}) {
  return (
    <section
      aria-labelledby={SUMMARY_HEADING_ID}
      className={cn(
        "flex flex-col gap-2 rounded-lg border bg-card p-3",
        className,
      )}
    >
      <h2 id={SUMMARY_HEADING_ID} className="text-sm font-semibold">
        خلاصه ترجیحات این ماه
      </h2>
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(6.75rem,1fr))] gap-1.5 text-xs">
        {PREFERENCE_OPTIONS.map((o) => (
          <li
            key={o.value}
            data-summary={o.value}
            className="flex min-h-8 items-center gap-1.5 rounded-md border px-1.5"
          >
            <ShiftChip code={o.value} size="xs" icon />
            <span>{o.short}</span>
            <span className="ms-auto font-semibold tabular-nums">
              <span className="sr-only">: </span>
              {faNumber(counts.byValue[o.value])}
            </span>
          </li>
        ))}
        <li
          data-summary="NONE"
          className="flex min-h-8 items-center gap-1.5 rounded-md border border-dashed px-1.5 text-muted-foreground"
        >
          <CircleDashed aria-hidden="true" className="size-3.5 shrink-0" />
          <span>{NO_PREFERENCE}</span>
          <span className="ms-auto font-semibold tabular-nums">
            <span className="sr-only">: </span>
            {faNumber(counts.none)}
          </span>
        </li>
      </ul>
    </section>
  );
}
