const SHIFT_LEGEND = [
  { code: "M", label: "صبح", className: "bg-shift-m text-shift-m-foreground" },
  { code: "E", label: "عصر", className: "bg-shift-e text-shift-e-foreground" },
  { code: "N", label: "شب", className: "bg-shift-n text-shift-n-foreground" },
  {
    code: "ME",
    label: "صبح و عصر",
    className: "bg-shift-me text-shift-me-foreground",
  },
] as const;

/** Shift colors are always paired with the shift code text (never color alone). */
export function ShiftLegend() {
  return (
    <ul className="flex flex-wrap gap-2" aria-label="انواع شیفت">
      {SHIFT_LEGEND.map((shift) => (
        <li
          key={shift.code}
          className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-sm ${shift.className}`}
        >
          <span className="font-bold" dir="ltr">
            {shift.code}
          </span>
          <span>{shift.label}</span>
        </li>
      ))}
    </ul>
  );
}
