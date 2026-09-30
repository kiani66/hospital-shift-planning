import { SHIFT_CODES } from "@/domain/shifts/shift-type";
import { ShiftChip } from "@/features/shifts/shift-chip";

/** Shift colors are always paired with the shift code text (never color alone). */
export function ShiftLegend() {
  return (
    <ul className="flex flex-wrap gap-2" aria-label="انواع شیفت">
      {SHIFT_CODES.map((code) => (
        <li key={code}>
          <ShiftChip code={code} size="md" label="full" className="px-3" />
        </li>
      ))}
    </ul>
  );
}
