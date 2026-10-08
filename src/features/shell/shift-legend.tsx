import { SHIFT_CODES } from "@/domain/shifts/shift-type";
import {
  shiftFullName,
  shiftHoursLabel,
  type ShiftLabels,
} from "@/features/shifts/catalog";
import { ShiftChip } from "@/features/shifts/shift-chip";

/**
 * Shift colors are always paired with the shift code text (never color alone).
 * `withHours` adds each shift's catalog hours (D42) after its chip.
 */
export function ShiftLegend({
  withHours = false,
  shiftLabels,
}: {
  withHours?: boolean;
  /** Descriptive shift names (`shift_types.label`). */
  shiftLabels: ShiftLabels;
}) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-2" aria-label="انواع شیفت">
      {SHIFT_CODES.map((code) => (
        <li key={code} className="inline-flex items-center gap-2">
          <ShiftChip
            code={code}
            size="md"
            label={shiftFullName(code, shiftLabels)}
            className="px-3"
          />
          {withHours && (
            <span className="text-xs text-muted-foreground tabular-nums">
              {shiftHoursLabel(code, shiftLabels)}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
