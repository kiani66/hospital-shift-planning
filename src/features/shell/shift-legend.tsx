import { SHIFT_CODES } from "@/domain/shifts/shift-type";
import { shiftHoursLabel } from "@/features/shifts/catalog";
import { ShiftChip } from "@/features/shifts/shift-chip";

/**
 * Shift colors are always paired with the shift code text (never color alone).
 * `withHours` adds each shift's catalog hours (D42) after its chip.
 */
export function ShiftLegend({ withHours = false }: { withHours?: boolean }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-2" aria-label="انواع شیفت">
      {SHIFT_CODES.map((code) => (
        <li key={code} className="inline-flex items-center gap-2">
          <ShiftChip code={code} size="md" label="full" className="px-3" />
          {withHours && (
            <span className="text-xs text-muted-foreground tabular-nums">
              {shiftHoursLabel(code)}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
