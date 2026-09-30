import type { ShiftCode } from "@/domain/shifts/shift-type";
import { cn } from "@/lib/utils";

import { SHIFT_PRESENTATION } from "./catalog";

const SIZES = {
  xs: "min-w-6 px-1 text-[0.6875rem] leading-4",
  sm: "min-w-7 px-1.5 text-xs leading-5",
  md: "min-w-9 px-1.5 py-0.5 text-sm",
} as const;

/**
 * A shift code as a chip. The code text is always rendered (left-to-right,
 * so "ME" never flips); the color comes from the catalog's `shift-*` tokens
 * and only reinforces it. `solid` fills the chip (a selected or assigned
 * shift); `soft` keeps a neutral surface with the shift's text color, for
 * dense views where many chips would otherwise turn into a rainbow.
 * `label` adds the Persian name after the code.
 */
export function ShiftChip({
  code,
  size = "sm",
  variant = "solid",
  label = false,
  className,
}: {
  code: ShiftCode;
  size?: keyof typeof SIZES;
  variant?: "solid" | "soft";
  label?: boolean | "full";
  className?: string;
}) {
  const shift = SHIFT_PRESENTATION[code];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center gap-1.5 rounded font-bold",
        SIZES[size],
        variant === "solid"
          ? shift.tokenClass
          : cn("border bg-background", shift.accentClass),
        className,
      )}
    >
      <span dir="ltr">{code}</span>
      {label && (
        <span className="font-medium">
          {label === "full" ? shift.fullName : shift.name}
        </span>
      )}
    </span>
  );
}
