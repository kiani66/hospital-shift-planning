import { SHIFT_CODES } from "@/domain/shifts/shift-type";
import { SHIFT_PRESENTATION } from "@/features/shifts/catalog";

/** Shift colors are always paired with the shift code text (never color alone). */
export function ShiftLegend() {
  return (
    <ul className="flex flex-wrap gap-2" aria-label="انواع شیفت">
      {SHIFT_CODES.map((code) => {
        const shift = SHIFT_PRESENTATION[code];
        return (
          <li
            key={code}
            className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-sm ${shift.tokenClass}`}
          >
            <span className="font-bold" dir="ltr">
              {code}
            </span>
            <span>{shift.fullName}</span>
          </li>
        );
      })}
    </ul>
  );
}
